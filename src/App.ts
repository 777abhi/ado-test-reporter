
import { IConfigService } from "./interfaces/IConfigService";
import { IAzureClientProvider } from "./interfaces/IAzureClientProvider";
import { ITestCaseService } from "./interfaces/ITestCaseService";
import { ITestPlanService } from "./interfaces/ITestPlanService";
import { IFailureTaskService } from "./interfaces/IFailureTaskService";
import { ILogger } from "./interfaces/ILogger";
import { ITestResultParser } from "./interfaces/ITestResultParser";
import { TestCaseResult } from "azure-devops-node-api/interfaces/TestInterfaces";
import { TestCaseService } from "./testCaseService";
import { TestPlanService } from "./testPlanService";
import { FailureTaskService } from "./failureTaskService";

// Regex to extract Test Case ID from test name (e.g. "UserLogin_TC1056")
const TC_ID_REGEX = /TC(\d+)/i;

export class App {
    constructor(
        private configService: IConfigService,
        private azureClientProvider: IAzureClientProvider,
        private parser: ITestResultParser,
        private logger: ILogger
    ) { }

    async run(argv: any, defaultJUnit: string) {
        const env = this.configService.loadEnvironment();
        const args = this.configService.loadArgs(argv, defaultJUnit);
        const clients = await this.azureClientProvider.createClients(env.token, env.orgUrl);

        const actualPlanName =
            args.planName.toLowerCase() === "auto-generate"
                ? `AutoPlan-${env.buildNumber || new Date().toISOString().replace(/[:.]/g, "-")}`
                : args.planName;
        const actualSuiteName =
            args.suiteName.toLowerCase() === "auto-generate"
                ? `AutoSuite-${env.buildNumber || new Date().toISOString().replace(/[:.]/g, "-")}`
                : args.suiteName;

        // Dependency Injection for Services
        const testCaseService: ITestCaseService = new TestCaseService(
            clients.workItemApi,
            env.project,
            env.fallbackToNameSearch,
            env.autoCreateTestCases,
            this.logger
        );
        const testPlanService: ITestPlanService = new TestPlanService(
            clients.testApi,
            clients.testPlanApi,
            env.project,
            env.orgUrl,
            env.autoCreatePlan,
            env.autoCreateSuite,
            this.logger
        );
        const failureTaskService: IFailureTaskService = new FailureTaskService(
            clients.workItemApi,
            env.project,
            env.orgUrl,
            this.logger,
            env.defectType
        );

        const planInfo = await testPlanService.ensurePlan(actualPlanName);
        const suiteInfo = await testPlanService.ensureSuite(
            planInfo.planId,
            planInfo.rootSuiteId,
            actualSuiteName
        );

        const parsedCases = await this.parser.parse(args.junitFile);
        if (!parsedCases.length) {
            this.logger.log("No test cases found in the JUnit file; exiting.");
            return;
        }
        this.logger.log(`🧪 Parsed ${parsedCases.length} test cases from JUnit.`);

        const resultsToPublish: TestCaseResult[] = [];
        const testCaseIdsToLink: string[] = [];
        const passedTestCaseIds: string[] = [];
        const failedForTask: {
            testCaseId: string;
            testName: string;
            errorMessage?: string;
        }[] = [];

        for (const tc of parsedCases) {
            const match = tc.name.match(TC_ID_REGEX);
            const resolvedTestCase = await testCaseService.resolve(
                tc.name,
                match ? match[1] : null
            );

            const resultModel: TestCaseResult = {
                testCaseTitle: tc.name,
                automatedTestName: tc.name,
                durationInMs: tc.durationMs,
                outcome: tc.outcome,
                state: "Completed",
                errorMessage: tc.errorMessage,
                testCase: { id: String(resolvedTestCase.id) },
                testCaseRevision: resolvedTestCase.revision,
            };

            testCaseIdsToLink.push(String(resolvedTestCase.id));
            resultsToPublish.push(resultModel);

            if (tc.outcome === "Failed") {
                failedForTask.push({
                    testCaseId: String(resolvedTestCase.id),
                    testName: tc.name,
                    errorMessage: tc.errorMessage,
                });
            } else if (tc.outcome === "Passed") {
                passedTestCaseIds.push(String(resolvedTestCase.id));
            }
        }

        await testPlanService.linkTestCasesToSuite(
            planInfo.planId,
            suiteInfo.suiteId,
            testCaseIdsToLink
        );

        const pointIds = await testPlanService.mapPointsToResults(
            planInfo.planId,
            suiteInfo.suiteId,
            resultsToPublish
        );
        this.logger.log(`📌 Mapped test points: ${pointIds.length} pointIds collected.`);

        const publishableResults = resultsToPublish.filter((r) => {
            this.logger.log(
                `🔍 Result mapping: ${r.testCaseTitle} -> TC ${r.testCase?.id}, Point ${r.testPoint?.id ?? "none"}`
            );
            if (!r.testPoint?.id) {
                this.logger.warn(
                    `⚠️ Skipping result for ${r.testCaseTitle} because no test point was found (would appear as Other).`
                );
                return false;
            }
            return true;
        });

        if (publishableResults.length === 0) {
            this.logger.warn(
                "⚠️ No results had mapped test points; run will not be published to avoid 'Other' entries."
            );
            return;
        }
        this.logger.log(
            `✅ Publishable results: ${publishableResults.length} (of ${resultsToPublish.length} processed).`
        );

        const runInfo = await testPlanService.createRunAndPublish(
            planInfo.planId,
            actualSuiteName,
            env.buildId,
            env.buildNumber,
            publishableResults,
            pointIds,
            args.attachResults ? args.junitFile : undefined
        );

        if (env.createFailureTasks) {
            for (const failure of failedForTask) {
                await failureTaskService.createTaskForFailure({
                    testCaseId: failure.testCaseId,
                    testName: failure.testName,
                    errorMessage: failure.errorMessage,
                    buildNumber: env.buildNumber,
                    runUrl: runInfo.runUrl,
                    runId: runInfo.runId,
                });
            }
        } else {
            this.logger.log(
                "ℹ️ Failure task creation is disabled (CREATE_FAILURE_TASKS=false)."
            );
        }

        if (env.autoCloseOnPass) {
            this.logger.log(`🔄 Auto-closing defects for ${passedTestCaseIds.length} passed tests...`);
            for (const tcId of passedTestCaseIds) {
                await failureTaskService.resolveTaskForSuccess(tcId, env.buildNumber);
            }
        }
    }
}
