import * as path from "path";
import yargsFactory from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { ConfigService } from "../config";
import { AzureClientProvider } from "../AzureClientProvider";
import { AuditLogger } from "../AuditLogger";
import { JUnitParser } from "../junitParser";
import { QuarantineService } from "../QuarantineService";
import { PrQualityGateService } from "../PrQualityGateService";
import { TestOutcomeSummary } from "../interfaces/IPrQualityGateService";
import { SecretRedactor } from "./SecretRedactor";

const TC_ID_REGEX = /TC(\d+)/i;

async function run() {
    const defaultJUnit = path.resolve(process.cwd(), "src/results.xml");
    const argv = yargsFactory(hideBin(process.argv))
        .options({
            "junit-file": {
                type: "string",
                demandOption: false,
                default: defaultJUnit,
                describe: `Path to JUnit XML (default: ${defaultJUnit})`,
            },
            "pr-id": {
                type: "number",
                demandOption: false,
                describe: "Azure Repos Pull Request ID (defaults to SYSTEM_PULLREQUEST_PULLREQUESTID)",
            },
            "pr-repo": {
                type: "string",
                demandOption: false,
                describe: "Azure Repos repository ID or name (defaults to BUILD_REPOSITORY_ID)",
            },
            "pr-target-branch": {
                type: "string",
                demandOption: false,
                describe: "Target branch for baseline comparison (defaults to SYSTEM_PULLREQUEST_TARGETBRANCH or refs/heads/main)",
            },
            "pr-status-check": {
                type: "boolean",
                demandOption: false,
                describe: "Publish an Azure Repos PR Status Check in addition to the PR comment",
            },
            "run-id": {
                type: "number",
                demandOption: false,
                describe: "Optional ADO Test Run ID to link in the PR comment",
            },
            "run-url": {
                type: "string",
                demandOption: false,
                describe: "Optional ADO Test Run URL to link in the PR comment",
            },
        })
        .parseSync();

    const configService = new ConfigService();
    const env = configService.loadEnvironment();
    const logger = new AuditLogger(env.auditLogPath);
    const azureClientProvider = new AzureClientProvider();

    const clients = await azureClientProvider.createClients(
        env.token,
        env.orgUrl,
        env.authType,
        logger
    );

    const parser = new JUnitParser();
    const junitFile = path.resolve(argv["junit-file"] || defaultJUnit);
    const parsedCases = await parser.parse(junitFile);

    const quarantineService = new QuarantineService(logger);
    const summaries: TestOutcomeSummary[] = parsedCases.map((tc) => {
        const match = tc.name.match(TC_ID_REGEX);
        const testCaseId = match ? match[1] : undefined;
        const isQuarantined = quarantineService.isQuarantined(testCaseId, tc.name);
        return {
            testName: tc.name,
            testCaseId,
            outcome: tc.outcome,
            durationMs: tc.durationMs,
            errorMessage: tc.errorMessage,
            isQuarantined,
        };
    });

    const prGateService = new PrQualityGateService(
        clients.testApi,
        clients.gitApi,
        logger,
        quarantineService
    );

    const gateResult = await prGateService.evaluateAndReport(summaries, {
        project: env.project,
        repositoryId: argv["pr-repo"] || env.prRepositoryId,
        pullRequestId: argv["pr-id"] || env.prId,
        targetBranch: argv["pr-target-branch"] || env.prTargetBranch,
        sourceBranch: env.prSourceBranch,
        commitSha: env.commitSha,
        buildId: env.buildId,
        buildNumber: env.buildNumber,
        buildUri: env.buildUri,
        runId: argv["run-id"],
        runUrl: argv["run-url"],
        publishStatusCheck: argv["pr-status-check"] ?? env.prStatusCheck,
        failOnNewRegressions: true,
    });

    logger.logAudit({
        eventType: "PR_GATE_EVALUATED",
        level: gateResult.passed ? "INFO" : "WARN",
        action: `PR Quality Gate ${gateResult.passed ? "PASSED" : "FAILED"}`,
        actor: env.triggerActor,
        buildId: env.buildId,
        commitSha: env.commitSha,
        status: gateResult.passed ? "SUCCESS" : "FAILURE",
        details: {
            baselineRunId: gateResult.baselineRunId,
            newRegressions: gateResult.newRegressions.length,
            knownBaselineFailures: gateResult.knownBaselineFailures.length,
            quarantinedFailures: gateResult.quarantinedFailures.length,
            commentThreadId: gateResult.commentThreadId,
        },
    });

    if (!gateResult.passed) {
        throw new Error(
            `❌ PR Quality Gate FAILED: ${gateResult.newRegressions.length} new regression(s) detected.`
        );
    }

    logger.log("✅ PR Quality Gate PASSED: 0 new regressions detected.");
}

run().catch((err) => {
    const errorStr = typeof err === "string" ? err : ((err as Error).message || JSON.stringify(err));
    console.error("💥 Error during PR Quality Gate execution:", SecretRedactor.redact(errorStr));
    process.exit(1);
});
