import * as path from "path";
import yargsFactory from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { ConfigService } from "./config";
import { AzureClientProvider } from "./AzureClientProvider";
import { App } from "./App";
import { IConfigService } from "./interfaces/IConfigService";
import { IAzureClientProvider } from "./interfaces/IAzureClientProvider";
import { ConsoleLogger } from "./ConsoleLogger";
import { AuditLogger } from "./AuditLogger";
import { JUnitParser } from "./junitParser";
import { TestCaseService } from "./testCaseService";
import { TestPlanService } from "./testPlanService";
import { FailureTaskService } from "./failureTaskService";
import { RunOptions } from "./interfaces/RunOptions";
import { SecretRedactor } from "./utils/SecretRedactor";
import { DashboardCacheRepository } from "./DashboardCacheRepository";
import { DashboardDataService } from "./DashboardDataService";
import { DashboardHtmlGenerator } from "./DashboardHtmlGenerator";
import { QuarantineService } from "./QuarantineService";
import { PrQualityGateService } from "./PrQualityGateService";
import { NotificationService } from "./NotificationService";
import { AlertRegressionItem } from "./interfaces/INotificationService";
import { isSafePath } from "./utils/PathUtils";
import * as fs from "fs";

async function run() {
  const defaultJUnit = path.resolve(process.cwd(), "src/results.xml");
  const argv = yargsFactory(hideBin(process.argv))
    .scriptName("ado-test-reporter publish")
    .options({
      "junit-file": {
        type: "string",
        demandOption: false,
        default: defaultJUnit,
        describe: `Path to JUnit XML (default: ${defaultJUnit})`,
      },
      "plan-name": {
        type: "string",
        demandOption: false,
        default: "test-plan-ado-test-reporter",
        describe: "Target Test Plan Name",
      },
      "suite-name": {
        type: "string",
        demandOption: false,
        default: "suite-name-ado-test-reporter",
        describe: "Target Test Suite Name",
      },
      "attach-results": {
        type: "boolean",
        demandOption: false,
        default: false,
        describe: "Attach JUnit results XML to the Test Run",
      },
      "artifacts-dir": {
        type: "string",
        demandOption: false,
        describe: "Directory containing test artifacts (screenshots, logs)",
      },
      "artifact-pattern": {
        type: "string",
        demandOption: false,
        default: "{testName}.png",
        describe: "Pattern to match artifacts (e.g., '{testName}.png', 'screenshot-{testName}.jpg')",
      },
      "generate-dashboard": {
        type: "boolean",
        demandOption: false,
        default: false,
        describe: "Generate an interactive HTML dashboard snapshot after publishing the test run",
      },
      "dashboard-days": {
        type: "number",
        demandOption: false,
        default: 30,
        describe: "Lookback window in days when generating the dashboard",
      },
      "dashboard-output": {
        type: "string",
        demandOption: false,
        default: "reports/ado-test-runs-dashboard.html",
        describe: "Output path for generated HTML dashboard",
      },
      "audit-evidence-output": {
        type: "string",
        demandOption: false,
        default: "reports/audit-evidence.json",
        describe: "Output path for generated cryptographic SHA-256 audit manifest",
      },
      "pr-gate": {
        type: "boolean",
        demandOption: false,
        describe: "Evaluate Azure Repos PR Quality Gate after publishing test results",
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
      "concurrency": {
        type: "number",
        demandOption: false,
        describe: "Maximum concurrent Azure DevOps API requests (1-20, default: 5)",
      },
      "batch-size": {
        type: "number",
        demandOption: false,
        describe: "Batch size for chunked ADO API calls (1-1000, default: 200)",
      },
      "webhook-url": {
        type: "string",
        demandOption: false,
        describe: "Slack, Microsoft Teams, or generic JSON webhook URL for failure/regression/quarantine alerts",
      },
      "webhook-type": {
        type: "string",
        demandOption: false,
        choices: ["auto", "slack", "teams", "json"],
        describe: "Webhook payload format (default: auto-detect from URL)",
      },
      "webhook-always": {
        type: "boolean",
        demandOption: false,
        describe: "Send webhook notification even when all tests pass with no regressions or expired quarantines",
      },
      "dry-run": {
        type: "boolean",
        demandOption: false,
        default: false,
        describe: "Parse JUnit XML and preview actions without making any changes in Azure DevOps",
      },
    })
    .strict()
    .help()
    .alias("h", "help")
    .parseSync();

  const configService: IConfigService = new ConfigService();
  const azureClientProvider: IAzureClientProvider = new AzureClientProvider();

  const args = configService.loadArgs(argv, defaultJUnit);

  if (!fs.existsSync(args.junitFile)) {
    throw new Error(
      `JUnit XML file not found: ${args.junitFile}. Pass --junit-file <path> to specify your test results file.`
    );
  }

  let env: ReturnType<IConfigService["loadEnvironment"]>;
  if (args.dryRun) {
    try {
      env = configService.loadEnvironment();
    } catch {
      env = {
        token: "",
        orgUrl: process.env.ADO_ORG_URL || "https://dev.azure.com/dry-run",
        project: process.env.ADO_PROJECT || "dry-run-project",
        buildId: 0,
        buildNumber: process.env.ADO_BUILD_NUMBER || "DryRun",
        createFailureTasks: true,
        defectType: process.env.ADO_DEFECT_TYPE || "Task",
        autoCloseOnPass: false,
        fallbackToNameSearch: false,
        autoCreateTestCases: true,
        autoCreatePlan: true,
        autoCreateSuite: true,
        htmlFields: [],
        detectFlakyTests: false,
        commitSha: "local-head",
        branch: "local",
        buildUri: "",
        triggerActor: process.env.USER || "dry-run",
        agentName: "local-runner",
        authType: "auto",
        autoCloseAllowedBranches: ["main", "master"],
        autoCloseTargetState: "Resolved",
        quarantineFailOnExpired: false,
        auditLogPath: process.env.ADO_AUDIT_LOG_PATH || "audit-events.ndjson",
        prGateEnabled: false,
        prId: 0,
        prRepositoryId: "",
        prTargetBranch: "refs/heads/main",
        prSourceBranch: "local",
        prStatusCheck: false,
        concurrency: 5,
        batchSize: 200,
        maxRetries: 3,
        retryBaseDelayMs: 500,
        webhookType: "auto",
        webhookAlways: false,
        webhookFailOnError: false,
      };
    }
  } else {
    env = configService.loadEnvironment();
  }

  const logger = new AuditLogger(env.auditLogPath);
  const parser = new JUnitParser();
  const quarantineService = new QuarantineService(logger);

  if (!args.dryRun) {
    logger.logAudit({
      eventType: "EXECUTION_STARTED",
      level: "INFO",
      action: "Starting ADO test sync execution",
      actor: env.triggerActor,
      buildId: env.buildId,
      commitSha: env.commitSha,
      details: {
        project: env.project,
        branch: env.branch,
        authType: env.authType,
        autoCloseTargetState: env.autoCloseTargetState,
      },
    });
  }

  const clients = args.dryRun
    ? ({} as Awaited<ReturnType<IAzureClientProvider["createClients"]>>)
    : await azureClientProvider.createClients(
        env.token,
        env.orgUrl,
        env.authType,
        logger,
        {
          maxRetries: env.maxRetries,
          baseDelayMs: env.retryBaseDelayMs,
        }
      );

  // Instantiate Services
  const testCaseService = new TestCaseService(
    clients.workItemApi,
    env.project,
    env.fallbackToNameSearch,
    env.autoCreateTestCases,
    logger
  );

  const testPlanService = new TestPlanService(
    clients.testApi,
    clients.testPlanApi,
    env.project,
    env.orgUrl,
    env.autoCreatePlan,
    env.autoCreateSuite,
    logger
  );

  const failureTaskService = new FailureTaskService(
    clients.workItemApi,
    env.project,
    env.orgUrl,
    logger,
    env.defectType,
    env.autoCloseAllowedBranches,
    env.autoCloseTargetState,
    env.branch
  );
  const app = new App(
    testCaseService,
    testPlanService,
    failureTaskService,
    parser,
    logger,
    quarantineService
  );

  const provenance = {
    commitSha: env.commitSha,
    branch: env.branch,
    buildId: env.buildId,
    buildNumber: env.buildNumber,
    buildUri: env.buildUri,
    triggerActor: env.triggerActor,
    agentName: env.agentName,
    timestamp: new Date().toISOString(),
  };

  const runOptions: RunOptions = {
    planName: args.planName,
    suiteName: args.suiteName,
    buildId: env.buildId,
    buildNumber: env.buildNumber,
    attachResults: args.attachResults,
    createFailureTasks: env.createFailureTasks,
    autoCloseOnPass: env.autoCloseOnPass,
    artifactsDir: args.artifactsDir,
    artifactPattern: args.artifactPattern,
    detectFlakyTests: env.detectFlakyTests,
    generateDashboard: args.generateDashboard,
    dashboardDays: args.dashboardDays,
    dashboardOutput: args.dashboardOutput,
    auditEvidenceOutput: args.auditEvidenceOutput,
    provenance: provenance,
    quarantineFailOnExpired: env.quarantineFailOnExpired,
    concurrency: args.concurrency ?? env.concurrency,
    batchSize: args.batchSize ?? env.batchSize,
    dryRun: args.dryRun,
  };

  const runSummary = await app.run(runOptions, args.junitFile);

  if (args.dryRun) {
    return;
  }

  logger.logAudit({
    eventType: "EXECUTION_COMPLETED",
    level: "INFO",
    action: "Completed ADO test sync execution",
    actor: env.triggerActor,
    buildId: env.buildId,
    commitSha: env.commitSha,
    status: "SUCCESS",
  });

  if (args.generateDashboard) {
    const days = args.dashboardDays || 30;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 86400000);
    const cacheRepo = new DashboardCacheRepository(logger);
    const dashboardService = new DashboardDataService(
      cacheRepo,
      logger,
      env.orgUrl,
      env.project,
      clients.testApi,
      clients.workItemApi,
      env.defectType
    );

    await dashboardService.syncFromAdo(startDate, endDate);
    const report = dashboardService.buildReport({
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
    });
    const outPath = path.resolve(args.dashboardOutput || "reports/ado-test-runs-dashboard.html");
    if (isSafePath(outPath, process.cwd())) {
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      const html = DashboardHtmlGenerator.generateHtml(report, cacheRepo.load(), {
        isLiveServer: false,
      });
      fs.writeFileSync(outPath, html, "utf-8");
      logger.log(`📊 Generated ADO Test Runs Insights Dashboard at: ${outPath}`);
    } else {
      logger.warn(`⚠️ Unsafe dashboard output path skipped: ${outPath}`);
    }
  }

  let prGateNewRegressions: AlertRegressionItem[] = [];
  let prGateFailureError: Error | undefined;

  const prGateActive = args.prGate ?? env.prGateEnabled;
  if (prGateActive) {
    const prGateService = new PrQualityGateService(
      clients.testApi,
      clients.gitApi,
      logger,
      quarantineService
    );
    const summaries =
      runSummary?.results ||
      (await parser.parse(args.junitFile)).map((tc) => ({
        testName: tc.name,
        outcome: tc.outcome,
        durationMs: tc.durationMs,
        errorMessage: tc.errorMessage,
      }));

    const gateResult = await prGateService.evaluateAndReport(summaries, {
      project: env.project,
      repositoryId: args.prRepo || env.prRepositoryId,
      pullRequestId: args.prId || env.prId,
      targetBranch: args.prTargetBranch || env.prTargetBranch,
      sourceBranch: env.prSourceBranch,
      commitSha: env.commitSha,
      buildId: env.buildId,
      buildNumber: env.buildNumber,
      buildUri: env.buildUri,
      runId: runSummary?.runId,
      runUrl: runSummary?.runUrl,
      publishStatusCheck: args.prStatusCheck ?? env.prStatusCheck,
      failOnNewRegressions: true,
    });

    prGateNewRegressions = gateResult.newRegressions.map((r) => ({
      testName: r.testName,
      testCaseId: r.testCaseId,
      errorMessage: r.errorMessage,
    }));

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
      prGateFailureError = new Error(
        `❌ PR Quality Gate FAILED: ${gateResult.newRegressions.length} new regression(s) detected.`
      );
    } else {
      logger.log("✅ PR Quality Gate PASSED: 0 new regressions detected.");
    }
  }

  const webhookUrl = args.webhookUrl || env.webhookUrl;
  if (webhookUrl) {
    const results = runSummary?.results || [];
    const passedTests = results.filter((r) => r.outcome === "Passed").length;
    const failedTests = results.filter((r) => r.outcome === "Failed" && !r.isQuarantined).length;
    const quarantinedTests = results.filter((r) => r.isQuarantined).length;
    const expiredQuarantines = quarantineService
      .load()
      .quarantinedTests
      .filter((e) => e.status === "expired")
      .map((e) => ({
        testKey: e.testKey,
        testName: e.testCaseTitle,
        expiresAt: e.expiresAt || "",
      }));

    const notificationService = new NotificationService(logger);
    await notificationService.notify(
      {
        project: env.project,
        buildNumber: env.buildNumber,
        branch: env.branch,
        runId: runSummary?.runId,
        runUrl: runSummary?.runUrl,
        totalTests: results.length,
        passedTests,
        failedTests,
        quarantinedTests,
        newRegressions: prGateNewRegressions,
        expiredQuarantines,
      },
      {
        webhookUrl,
        webhookType: args.webhookType ?? env.webhookType,
        always: args.webhookAlways ?? env.webhookAlways,
        failOnError: env.webhookFailOnError,
      }
    );
  }

  if (prGateFailureError) {
    throw prGateFailureError;
  }
}

run().catch((err) => {
  const errorStr = typeof err === 'string' ? err : ((err as Error).message || JSON.stringify(err));
  console.error("💥 Error during execution:", SecretRedactor.redact(errorStr));
  process.exit(1);
});
