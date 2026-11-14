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
import { isSafePath } from "./utils/PathUtils";
import * as fs from "fs";

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
    })
    .parseSync();

  const configService: IConfigService = new ConfigService();
  const azureClientProvider: IAzureClientProvider = new AzureClientProvider();

  const env = configService.loadEnvironment();
  const args = configService.loadArgs(argv, defaultJUnit);

  const logger = new AuditLogger(env.auditLogPath);
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

  const clients = await azureClientProvider.createClients(
    env.token,
    env.orgUrl,
    env.authType,
    logger
  );
  const parser = new JUnitParser();

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
  const quarantineService = new QuarantineService(logger);
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
  };

  const runSummary = await app.run(runOptions, args.junitFile);

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
}

run().catch((err) => {
  const errorStr = typeof err === 'string' ? err : ((err as Error).message || JSON.stringify(err));
  console.error("💥 Error during execution:", SecretRedactor.redact(errorStr));
  process.exit(1);
});
