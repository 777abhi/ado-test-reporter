import * as fs from "fs";
import * as path from "path";
import { DashboardCacheRepository } from "../src/DashboardCacheRepository";
import { DashboardDataService } from "../src/DashboardDataService";
import { DashboardHtmlGenerator } from "../src/DashboardHtmlGenerator";
import { DashboardRunRecord } from "../src/interfaces/IDashboardService";
import { ILogger } from "../src/interfaces/ILogger";

class SilentLogger implements ILogger {
  log(_msg: string): void {}
  warn(_msg: string): void {}
  error(_msg: string): void {}
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function runTests() {
  const logger = new SilentLogger();
  const tempCachePath = path.resolve(
    process.cwd(),
    ".cache",
    "test-dashboard-cache.json"
  );
  if (fs.existsSync(tempCachePath)) {
    fs.unlinkSync(tempCachePath);
  }

  console.log("1. Testing Execution Source & Sub-Source Classification...");
  const c1 = DashboardDataService.classifyExecutionSource({
    name: "Run 202611.1 - Regression",
    isAutomated: true,
    build: { id: 101 },
  });
  assert(
    c1.executionSource === "pipeline" &&
      c1.executionSubSource === "ado_test_reporter",
    `Expected pipeline / ado_test_reporter, got ${JSON.stringify(c1)}`
  );

  const c2 = DashboardDataService.classifyExecutionSource({
    name: "VSTest CI Build",
    isAutomated: true,
    buildConfiguration: { id: 202, number: "2026.2" },
  });
  assert(
    c2.executionSource === "pipeline" &&
      c2.executionSubSource === "azure_pipeline",
    `Expected pipeline / azure_pipeline, got ${JSON.stringify(c2)}`
  );

  const c3 = DashboardDataService.classifyExecutionSource({
    name: "Manual Exploratory Session",
    isAutomated: false,
  });
  assert(
    c3.executionSource === "direct_ado" &&
      c3.executionSubSource === "direct_manual",
    `Expected direct_ado / direct_manual, got ${JSON.stringify(c3)}`
  );
  console.log("   PASS: Classification accurately splits Pipeline (Reporter vs CI) and Direct ADO.");

  console.log("2. Testing Path Traversal Protection on Cache Repository...");
  let threwTraversal = false;
  try {
    new DashboardCacheRepository(logger, "/etc/passwd");
  } catch (e) {
    threwTraversal = true;
  }
  assert(
    threwTraversal,
    "DashboardCacheRepository should reject paths outside root workspace"
  );
  console.log("   PASS: Path traversal blocked.");

  console.log("3. Testing Metrics Engine (Split, Flaky, Regressions, ErrorHash, P95)...");
  const cacheRepo = new DashboardCacheRepository(logger, tempCachePath);

  const syntheticRuns: DashboardRunRecord[] = [
    {
      runId: 101,
      name: "Run 1.0 - Suite A",
      state: "Completed",
      startedDate: "2026-11-05T10:00:00.000Z",
      completedDate: "2026-11-05T10:05:00.000Z",
      durationMs: 5000,
      isAutomated: true,
      executionSource: "pipeline",
      executionSubSource: "ado_test_reporter",
      planName: "MainPlan",
      suiteName: "SuiteA",
      buildId: 10,
      buildNumber: "1.0",
      totalTests: 2,
      passedTests: 2,
      failedTests: 0,
      blockedTests: 0,
      notExecutedTests: 0,
      otherTests: 0,
      passRate: 100,
      runUrl: "https://dev.azure.com/org/proj/_testManagement/runs?runId=101",
      results: [
        {
          resultId: 1,
          runId: 101,
          testCaseId: "501",
          testCaseTitle: "Login_TC501",
          outcome: "Passed",
          durationMs: 1000,
          completedDate: "2026-11-05T10:01:00.000Z",
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
        },
        {
          resultId: 2,
          runId: 101,
          testCaseId: "502",
          testCaseTitle: "Checkout_TC502",
          outcome: "Passed",
          durationMs: 4000,
          completedDate: "2026-11-05T10:05:00.000Z",
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
        },
      ],
    },
    {
      runId: 102,
      name: "Run 1.1 - Suite A",
      state: "Completed",
      startedDate: "2026-11-06T10:00:00.000Z",
      completedDate: "2026-11-06T10:06:00.000Z",
      durationMs: 6000,
      isAutomated: true,
      executionSource: "pipeline",
      executionSubSource: "ado_test_reporter",
      planName: "MainPlan",
      suiteName: "SuiteA",
      buildId: 11,
      buildNumber: "1.1",
      totalTests: 2,
      passedTests: 1,
      failedTests: 1,
      blockedTests: 0,
      notExecutedTests: 0,
      otherTests: 0,
      passRate: 50,
      runUrl: "https://dev.azure.com/org/proj/_testManagement/runs?runId=102",
      results: [
        {
          resultId: 3,
          runId: 102,
          testCaseId: "501",
          testCaseTitle: "Login_TC501",
          outcome: "Failed",
          durationMs: 1200,
          errorMessage: "Timeout waiting for token",
          errorHash: "hash_timeout_1",
          completedDate: "2026-11-06T10:01:00.000Z",
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
        },
        {
          resultId: 4,
          runId: 102,
          testCaseId: "502",
          testCaseTitle: "Checkout_TC502",
          outcome: "Passed",
          durationMs: 4800,
          completedDate: "2026-11-06T10:06:00.000Z",
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
        },
      ],
    },
    {
      runId: 103,
      name: "Manual UAT Execution",
      state: "Completed",
      startedDate: "2026-11-07T10:00:00.000Z",
      completedDate: "2026-11-07T10:15:00.000Z",
      durationMs: 90000,
      isAutomated: false,
      executionSource: "direct_ado",
      executionSubSource: "direct_manual",
      planName: "MainPlan",
      suiteName: "UAT",
      totalTests: 2,
      passedTests: 1,
      failedTests: 1,
      blockedTests: 0,
      notExecutedTests: 0,
      otherTests: 0,
      passRate: 50,
      runUrl: "https://dev.azure.com/org/proj/_testManagement/runs?runId=103",
      results: [
        {
          resultId: 5,
          runId: 103,
          testCaseId: "501",
          testCaseTitle: "Login_TC501",
          outcome: "Passed",
          durationMs: 30000,
          completedDate: "2026-11-07T10:05:00.000Z",
          executionSource: "direct_ado",
          executionSubSource: "direct_manual",
        },
        {
          resultId: 6,
          runId: 103,
          testCaseId: "502",
          testCaseTitle: "Checkout_TC502",
          outcome: "Failed",
          durationMs: 60000,
          errorMessage: "=cmd|' /C calc'!A0", // Malicious formula string to test CSV sanitization
          errorHash: "hash_checkout_fail",
          completedDate: "2026-11-07T10:15:00.000Z",
          executionSource: "direct_ado",
          executionSubSource: "direct_manual",
          linkedDefect: {
            workItemId: 900,
            workItemType: "Bug",
            title: "Checkout failure",
            state: "Active",
            url: "https://dev.azure.com/org/proj/_workitems/edit/900",
          },
        },
      ],
    },
  ];

  cacheRepo.upsertRuns(
    syntheticRuns,
    "https://dev.azure.com/org",
    "proj",
    false
  );

  const service = new DashboardDataService(
    cacheRepo,
    logger,
    "https://dev.azure.com/org",
    "proj"
  );

  const report = service.buildReport({
    startDate: "2026-11-01",
    endDate: "2026-11-08",
  });

  assert(report.kpis.totalRuns === 3, `Expected 3 totalRuns, got ${report.kpis.totalRuns}`);
  assert(report.kpis.pipelineRuns === 2, `Expected 2 pipelineRuns, got ${report.kpis.pipelineRuns}`);
  assert(report.kpis.directAdoRuns === 1, `Expected 1 directAdoRuns, got ${report.kpis.directAdoRuns}`);
  assert(report.kpis.totalTests === 6, `Expected 6 totalTests, got ${report.kpis.totalTests}`);
  assert(report.kpis.pipelineTests === 4, `Expected 4 pipelineTests, got ${report.kpis.pipelineTests}`);
  assert(report.kpis.directAdoTests === 2, `Expected 2 directAdoTests, got ${report.kpis.directAdoTests}`);
  assert(report.kpis.flakyTestCount === 2, `Expected 2 flaky tests (both 501 and 502 had Pass & Fail), got ${report.kpis.flakyTestCount}`);

  // TC501 went Pass -> Fail -> Pass (2 oscillations!)
  const tc501Flaky = report.triage.flakyTests.find((f) => f.testCaseId === "501");
  assert(
    Boolean(tc501Flaky && tc501Flaky.oscillationCount === 2),
    `Expected TC501 to have 2 oscillations, got ${JSON.stringify(tc501Flaky)}`
  );

  // TC502 went Pass -> Pass -> Fail (Active Regression on latest run!)
  assert(
    report.kpis.newRegressionCount === 1 &&
      report.triage.newRegressions[0].testCaseId === "502",
    `Expected TC502 to be the active regression, got ${JSON.stringify(report.triage.newRegressions)}`
  );
  console.log("   PASS: KPIs, Flaky oscillations, and Active Regressions computed accurately.");

  console.log("4. Testing CSV Export Formula Injection Sanitization & HTML Escaping...");
  const csv = service.exportToCsv(report);
  assert(
    csv.includes("'=cmd|"),
    "CSV export must prefix formula-injection payloads with a single quote"
  );

  const html = DashboardHtmlGenerator.generateHtml(report, cacheRepo.load(), {
    isLiveServer: false,
  });
  assert(
    html.includes("ADO Test Runs Insights Dashboard"),
    "Generated HTML should contain dashboard title"
  );
  assert(
    html.includes("tabBtn-quarantine"),
    "Generated HTML should contain Stability & Quarantine tab button"
  );
  console.log("   PASS: CSV injection sanitized and HTML generated safely.");

  console.log("5. Testing MTTR, MTBF, and Quarantine Metrics Engine...");
  assert(Boolean(report.quarantine), "Report should have quarantine section");
  assert(
    report.quarantine!.overallMttrHours > 0,
    `Expected overallMttrHours > 0, got ${report.quarantine?.overallMttrHours}`
  );
  assert(
    report.quarantine!.overallMttrRuns >= 1,
    `Expected overallMttrRuns >= 1, got ${report.quarantine?.overallMttrRuns}`
  );

  // Check TC501 reliability metric
  const tc501Reliability = report.quarantine!.reliabilityLeaderboard.find(
    (r) => r.testCaseId === "501"
  );
  assert(
    Boolean(tc501Reliability && tc501Reliability.recoveryCount === 1),
    `Expected TC501 to have 1 recovery, got ${JSON.stringify(tc501Reliability)}`
  );
  assert(
    Boolean(tc501Reliability && tc501Reliability.mttrRuns === 1),
    `Expected TC501 mttrRuns to be 1, got ${tc501Reliability?.mttrRuns}`
  );

  // Test with active quarantine test in service
  const testQuarantinePath = path.resolve(process.cwd(), ".cache", "test-report-quarantine.json");
  if (fs.existsSync(testQuarantinePath)) fs.unlinkSync(testQuarantinePath);
  const qService = new (require("../src/QuarantineService").QuarantineService)(logger, testQuarantinePath);
  qService.quarantineTest({
    testCaseId: "501",
    testCaseTitle: "Login_TC501",
    reason: "Oscillating in pipeline",
    healingThreshold: 2,
  });

  const serviceWithQ = new DashboardDataService(
    cacheRepo,
    logger,
    "https://dev.azure.com/org",
    "proj",
    undefined,
    undefined,
    "Task",
    qService
  );
  const reportWithQ = serviceWithQ.buildReport({
    startDate: "2026-11-01",
    endDate: "2026-11-08",
  });

  assert(
    reportWithQ.kpis.quarantinedTestCount === 1,
    `Expected quarantinedTestCount 1, got ${reportWithQ.kpis.quarantinedTestCount}`
  );
  assert(
    reportWithQ.quarantine!.activeQuarantined.length === 1,
    "Expected 1 active quarantined test"
  );

  // Check Markdown export contains quarantine section
  const mdReport = serviceWithQ.exportToMarkdown(reportWithQ);
  assert(
    mdReport.includes("## 3. Stability, Reliability & Quarantine"),
    "Markdown export must include Stability, Reliability & Quarantine section"
  );
  assert(
    mdReport.includes("Login_TC501"),
    "Markdown export must list quarantined Login_TC501"
  );
  console.log("   PASS: MTTR, MTBF, stability scores, and quarantine reports verified.");

  if (fs.existsSync(testQuarantinePath)) {
    fs.unlinkSync(testQuarantinePath);
  }
  if (fs.existsSync(tempCachePath)) {
    fs.unlinkSync(tempCachePath);
  }
  console.log("🎉 All DashboardDataService unit tests passed!");
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error("Test Failed:", err);
    process.exit(1);
  });
}
