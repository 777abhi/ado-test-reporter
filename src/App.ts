import { ITestCaseService } from "./interfaces/ITestCaseService";
import { ITestPlanService, TestCaseResultWithAttachments } from "./interfaces/ITestPlanService";
import { IFailureTaskService } from "./interfaces/IFailureTaskService";
import { ILogger } from "./interfaces/ILogger";
import { ITestResultParser } from "./interfaces/ITestResultParser";
import { RunOptions } from "./interfaces/RunOptions";
import * as fs from "fs";
import * as path from "path";
import { isSafePath } from "./utils/PathUtils";

// Regex to extract Test Case ID from test name (e.g. "UserLogin_TC1056")
const TC_ID_REGEX = /TC(\d+)/i;

export class App {
    constructor(
        private testCaseService: ITestCaseService,
        private testPlanService: ITestPlanService,
        private failureTaskService: IFailureTaskService,
        private parser: ITestResultParser,
        private logger: ILogger
    ) { }

    async run(options: RunOptions, junitFile: string) {
        const { planName, suiteName, buildId, buildNumber, attachResults, createFailureTasks, autoCloseOnPass } = options;

        const actualPlanName =
            planName.toLowerCase() === "auto-generate"
                ? `AutoPlan-${buildNumber || new Date().toISOString().replace(/[:.]/g, "-")}`
                : planName;
        const actualSuiteName =
            suiteName.toLowerCase() === "auto-generate"
                ? `AutoSuite-${buildNumber || new Date().toISOString().replace(/[:.]/g, "-")}`
                : suiteName;

        const planInfo = await this.testPlanService.ensurePlan(actualPlanName);
        const suiteInfo = await this.testPlanService.ensureSuite(
            planInfo.planId,
            planInfo.rootSuiteId,
            actualSuiteName
        );

        const parsedCases = await this.parser.parse(junitFile);
        if (!parsedCases.length) {
            this.logger.log("No test cases found in the JUnit file; exiting.");
            return;
        }
        this.logger.log(`🧪 Parsed ${parsedCases.length} test cases from JUnit.`);

        if (options.artifactsDir) {
            const artifactsDir = path.resolve(options.artifactsDir);
            const pattern = options.artifactPattern || "{testName}.png";

            if (fs.existsSync(artifactsDir)) {
                this.logger.log(`📂 Scanning for artifacts in: ${artifactsDir} using pattern: ${pattern}`);
                let matchCount = 0;

                for (const tc of parsedCases) {
                    // Sanitize test name for filename usage (basic replacement of illegal chars)
                    // Note: User's test runner might have specific naming conventions.
                    // We'll replace spaces with placeholders if needed or just use raw if file exists.
                    // For now, let's try direct substitution.
                    const safeTestName = tc.name.replace(/[^a-zA-Z0-9_\- ]/g, "_"); // Basic sanitization

                    // Support multiple patterns (comma separated)
                    const patterns = pattern.split(",");

                    for (const pat of patterns) {
                        const filename = pat.trim().replace("{testName}", safeTestName);
                        const artifactPath = path.resolve(artifactsDir, filename);

                        if (fs.existsSync(artifactPath)) {
                             // Validate path security (ensure it doesn't traverse out of artifactsDir)
                             if (isSafePath(artifactPath, artifactsDir)) {
                                 if (!tc.attachments) {
                                     tc.attachments = [];
                                 }
                                 // check for duplicates
                                 if (!tc.attachments.includes(artifactPath)) {
                                     tc.attachments.push(artifactPath);
                                     matchCount++;
                                 }
                             } else {
                                 this.logger.warn(`⚠️ Unsafe artifact path detected and skipped: ${artifactPath}`);
                             }
                        }
                    }
                }
                this.logger.log(`📎 Found ${matchCount} artifacts matching test cases.`);
            } else {
                this.logger.warn(`⚠️ Artifacts directory not found: ${artifactsDir}`);
            }
        }

        const resultsToPublish: TestCaseResultWithAttachments[] = [];
        const testCaseIdsToLink: string[] = [];
        const passedTestCaseIds: string[] = [];
        const failedForTask: {
            testCaseId: string;
            testName: string;
            errorMessage?: string;
            attachments?: string[];
        }[] = [];

        for (const tc of parsedCases) {
            const match = tc.name.match(TC_ID_REGEX);
            const resolvedTestCase = await this.testCaseService.resolve(
                tc.name,
                match ? match[1] : null
            );

            const resultModel: TestCaseResultWithAttachments = {
                testCaseTitle: tc.name,
                automatedTestName: tc.name,
                durationInMs: tc.durationMs,
                outcome: tc.outcome,
                state: "Completed",
                errorMessage: tc.errorMessage,
                testCase: { id: String(resolvedTestCase.id) },
                testCaseRevision: resolvedTestCase.revision,
                localAttachments: tc.attachments,
            };

            testCaseIdsToLink.push(String(resolvedTestCase.id));
            resultsToPublish.push(resultModel);

            if (tc.outcome === "Failed") {
                failedForTask.push({
                    testCaseId: String(resolvedTestCase.id),
                    testName: tc.name,
                    errorMessage: tc.errorMessage,
                    attachments: tc.attachments,
                });
            } else if (tc.outcome === "Passed") {
                passedTestCaseIds.push(String(resolvedTestCase.id));
            }
        }

        await this.testPlanService.linkTestCasesToSuite(
            planInfo.planId,
            suiteInfo.suiteId,
            testCaseIdsToLink
        );

        const pointIds = await this.testPlanService.mapPointsToResults(
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

        const runInfo = await this.testPlanService.createRunAndPublish(
            planInfo.planId,
            actualSuiteName,
            buildId,
            buildNumber,
            publishableResults,
            pointIds,
            attachResults ? junitFile : undefined
        );

        if (createFailureTasks) {
            for (const failure of failedForTask) {
                await this.failureTaskService.createTaskForFailure({
                    testCaseId: failure.testCaseId,
                    testName: failure.testName,
                    errorMessage: failure.errorMessage,
                    buildNumber: buildNumber,
                    runUrl: runInfo.runUrl,
                    runId: runInfo.runId,
                    attachments: failure.attachments,
                });
            }
        } else {
            this.logger.log(
                "ℹ️ Failure task creation is disabled (CREATE_FAILURE_TASKS=false)."
            );
        }

        if (autoCloseOnPass) {
            this.logger.log(`🔄 Auto-closing defects for ${passedTestCaseIds.length} passed tests...`);
            for (const tcId of passedTestCaseIds) {
                await this.failureTaskService.resolveTaskForSuccess(tcId, buildNumber);
            }
        }
    }
}
