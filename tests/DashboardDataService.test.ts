import * as fs from "fs";
import * as path from "path";
import { DashboardCacheRepository } from "../src/DashboardCacheRepository";
import { DashboardDataService } from "../src/DashboardDataService";
import { DashboardHtmlGenerator } from "../src/DashboardHtmlGenerator";
import { QuarantineService } from "../src/QuarantineService";
import { DashboardRunRecord } from "../src/interfaces/IDashboardService";
import { ILogger } from "../src/interfaces/ILogger";

class SilentLogger implements ILogger {
  log(_msg: string): void {}
  warn(_msg: string): void {}
  error(_msg: string): void {}
}

describe("DashboardDataService & DashboardCacheRepository", () => {
  const logger = new SilentLogger();
  const tempCachePath = path.resolve(
    process.cwd(),
    ".cache",
    "test-dashboard-cache.json"
  );
  const testQuarantinePath = path.resolve(
    process.cwd(),
    ".cache",
    "test-report-quarantine.json"
  );

  beforeEach(() => {
    if (fs.existsSync(tempCachePath)) {
      fs.unlinkSync(tempCachePath);
    }
    if (fs.existsSync(testQuarantinePath)) {
      fs.unlinkSync(testQuarantinePath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempCachePath)) {
      fs.unlinkSync(tempCachePath);
    }
    if (fs.existsSync(testQuarantinePath)) {
      fs.unlinkSync(testQuarantinePath);
    }
  });

  it("should classify execution sources correctly into pipeline vs direct ADO", () => {
    const c1 = DashboardDataService.classifyExecutionSource({
      name: "Run 202611.1 - Regression",
      isAutomated: true,
      build: { id: 101 },
    });
    expect(c1.executionSource).toBe("pipeline");
    expect(c1.executionSubSource).toBe("ado_test_reporter");

    const c2 = DashboardDataService.classifyExecutionSource({
      name: "VSTest CI Build",
      isAutomated: true,
      buildConfiguration: { id: 202, number: "2026.2" },
    });
    expect(c2.executionSource).toBe("pipeline");
    expect(c2.executionSubSource).toBe("azure_pipeline");

    const c3 = DashboardDataService.classifyExecutionSource({
      name: "Manual Exploratory Session",
      isAutomated: false,
    });
    expect(c3.executionSource).toBe("direct_ado");
    expect(c3.executionSubSource).toBe("direct_manual");
  });

  it("should enforce path traversal protection on cache repository path", () => {
    expect(() => {
      new DashboardCacheRepository(logger, "/etc/passwd");
    }).toThrow();
  });

  it("should calculate metrics, KPIs, flaky oscillations, and active regressions", () => {
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

    expect(report.kpis.totalRuns).toBe(3);
    expect(report.kpis.pipelineRuns).toBe(2);
    expect(report.kpis.directAdoRuns).toBe(1);
    expect(report.kpis.totalTests).toBe(6);
    expect(report.kpis.pipelineTests).toBe(4);
    expect(report.kpis.directAdoTests).toBe(2);
    expect(report.kpis.flakyTestCount).toBe(2);

    const tc501Flaky = report.triage.flakyTests.find((f) => f.testCaseId === "501");
    expect(tc501Flaky).toBeDefined();
    expect(tc501Flaky?.oscillationCount).toBe(2);

    expect(report.kpis.newRegressionCount).toBe(1);
    expect(report.triage.newRegressions[0].testCaseId).toBe("502");

    // CSV export sanitization
    const csv = service.exportToCsv(report);
    expect(csv).toContain("'=cmd|");

    // HTML dashboard rendering
    const html = DashboardHtmlGenerator.generateHtml(report, cacheRepo.load(), {
      isLiveServer: false,
    });
    expect(html).toContain("ADO Test Runs Insights Dashboard");
    expect(html).toContain("tabBtn-quarantine");

    // MTTR & Reliability analytics
    expect(report.quarantine).toBeDefined();
    expect(report.quarantine!.overallMttrHours).toBeGreaterThan(0);
    expect(report.quarantine!.overallMttrRuns).toBeGreaterThanOrEqual(1);

    const tc501Reliability = report.quarantine!.reliabilityLeaderboard.find(
      (r) => r.testCaseId === "501"
    );
    expect(tc501Reliability).toBeDefined();
    expect(tc501Reliability?.recoveryCount).toBe(1);
    expect(tc501Reliability?.mttrRuns).toBe(1);

    // Active quarantine integration in report
    const qService = new QuarantineService(logger, testQuarantinePath);
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

    expect(reportWithQ.kpis.quarantinedTestCount).toBe(1);
    expect(reportWithQ.quarantine!.activeQuarantined.length).toBe(1);

    const mdReport = serviceWithQ.exportToMarkdown(reportWithQ);
    expect(mdReport).toContain("## 3. Stability, Reliability & Quarantine");
    expect(mdReport).toContain("Login_TC501");
  });
});
