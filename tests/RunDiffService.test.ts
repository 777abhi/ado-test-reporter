import { RunDiffService } from "../src/RunDiffService";
import { DashboardRunRecord, DashboardInsightsReport } from "../src/interfaces/IDashboardService";
import { QuarantinedTestRecord } from "../src/interfaces/IQuarantineService";
import { DashboardHtmlGenerator } from "../src/DashboardHtmlGenerator";

function makeRun(overrides: Partial<DashboardRunRecord> = {}): DashboardRunRecord {
  return {
    runId: 100,
    name: "CI Pipeline Run",
    state: "Completed",
    startedDate: "2026-11-15T10:00:00Z",
    completedDate: "2026-11-15T10:05:00Z",
    durationMs: 300000,
    isAutomated: true,
    executionSource: "pipeline",
    executionSubSource: "ado_test_reporter",
    planName: "Regression Plan",
    totalTests: 4,
    passedTests: 3,
    failedTests: 1,
    blockedTests: 0,
    notExecutedTests: 0,
    otherTests: 0,
    passRate: 75,
    runUrl: "https://dev.azure.com/org/proj/_testManagement/runs?runId=100",
    results: [],
    ...overrides,
  };
}

describe("RunDiffService", () => {
  it("classifies new regressions, known baseline failures, quarantined failures, and fixed tests", () => {
    const baseline = makeRun({
      runId: 101,
      name: "Main Baseline",
      completedDate: "2026-11-14T10:00:00Z",
      durationMs: 250000,
      passRate: 50,
      passedTests: 2,
      failedTests: 2,
      results: [
        {
          resultId: 1,
          runId: 101,
          testCaseId: "1001",
          testCaseTitle: "Known failing checkout test",
          outcome: "Failed",
          durationMs: 1200,
          errorMessage: "Timeout waiting for payment gateway",
          completedDate: "2026-11-14T10:01:00Z",
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
        },
        {
          resultId: 2,
          runId: 101,
          testCaseId: "1002",
          testCaseTitle: "Fixed login test",
          outcome: "Failed",
          durationMs: 800,
          errorMessage: "500 Internal Server Error",
          completedDate: "2026-11-14T10:02:00Z",
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
        },
      ],
    });

    const candidate = makeRun({
      runId: 102,
      name: "PR #42 Verification",
      completedDate: "2026-11-15T10:00:00Z",
      durationMs: 220000,
      passRate: 25,
      passedTests: 1,
      failedTests: 3,
      results: [
        {
          resultId: 10,
          runId: 102,
          testCaseId: "1001",
          testCaseTitle: "Known failing checkout test",
          outcome: "Failed",
          durationMs: 1100,
          errorMessage: "Timeout waiting for payment gateway",
          completedDate: "2026-11-15T10:01:00Z",
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
        },
        {
          resultId: 11,
          runId: 102,
          testCaseId: "1002",
          testCaseTitle: "Fixed login test",
          outcome: "Passed",
          durationMs: 600,
          completedDate: "2026-11-15T10:02:00Z",
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
        },
        {
          resultId: 12,
          runId: 102,
          testCaseId: "1003",
          testCaseTitle: "Flaky cart sync",
          outcome: "Failed",
          durationMs: 900,
          errorMessage: "Race condition",
          completedDate: "2026-11-15T10:03:00Z",
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
        },
        {
          resultId: 13,
          runId: 102,
          testCaseId: "1004",
          testCaseTitle: "New search regression",
          outcome: "Failed",
          durationMs: 1500,
          errorMessage: "Expected 200, got 404",
          completedDate: "2026-11-15T10:04:00Z",
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
        },
      ],
    });

    const quarantined: QuarantinedTestRecord[] = [
      {
        testKey: "tc:1003",
        testCaseId: "1003",
        testCaseTitle: "Flaky cart sync",
        reason: "Known CI race",
        quarantinedAt: "2026-11-10T00:00:00Z",
        expiresAt: "2026-12-10T00:00:00Z",
        quarantinedBy: "qa-lead",
        status: "active",
        consecutivePasses: 0,
        healingThreshold: 5,
      },
    ];

    const diff = RunDiffService.diffRuns(candidate, baseline, quarantined);

    expect(diff.passed).toBe(false);
    expect(diff.newRegressions).toHaveLength(1);
    expect(diff.newRegressions[0].testCaseId).toBe("1004");
    expect(diff.knownBaselineFailures).toHaveLength(1);
    expect(diff.knownBaselineFailures[0].testCaseId).toBe("1001");
    expect(diff.quarantinedFailures).toHaveLength(1);
    expect(diff.quarantinedFailures[0].testCaseId).toBe("1003");
    expect(diff.fixedTests).toHaveLength(1);
    expect(diff.fixedTests[0].testCaseId).toBe("1002");
    expect(diff.deltas.passRateDeltaPct).toBe(-25);
    expect(diff.deltas.durationDeltaMs).toBe(-30000);
    expect(diff.summaryMarkdown).toContain("❌ **FAILED**");
    expect(diff.summaryMarkdown).toContain("New search regression");
  });

  it("passes the PR gate when all failures are either known baseline or quarantined", () => {
    const baseline = makeRun({
      runId: 201,
      results: [
        {
          resultId: 1,
          runId: 201,
          testCaseTitle: "TC55_Legacy_Failure",
          outcome: "Failed",
          durationMs: 100,
          completedDate: "2026-11-14T10:00:00Z",
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
        },
      ],
    });

    const candidate = makeRun({
      runId: 202,
      results: [
        {
          resultId: 2,
          runId: 202,
          testCaseTitle: "Legacy Failure",
          outcome: "Failed",
          durationMs: 100,
          completedDate: "2026-11-15T10:00:00Z",
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
        },
      ],
    });

    const diff = RunDiffService.diffRuns(candidate, baseline, []);

    expect(diff.passed).toBe(true);
    expect(diff.newRegressions).toHaveLength(0);
    expect(diff.knownBaselineFailures).toHaveLength(1);
    expect(diff.summaryMarkdown).toContain("✅ **PASSED**");
  });

  it("selectDefaultRuns prefers the most recent earlier run in the same plan", () => {
    const r1 = makeRun({
      runId: 1,
      planName: "Smoke Plan",
      completedDate: "2026-11-13T10:00:00Z",
    });
    const r2 = makeRun({
      runId: 2,
      planName: "Other Plan",
      completedDate: "2026-11-14T10:00:00Z",
    });
    const r3 = makeRun({
      runId: 3,
      planName: "Smoke Plan",
      completedDate: "2026-11-15T10:00:00Z",
    });

    const { candidateRun, baselineRun } = RunDiffService.selectDefaultRuns([r1, r2, r3]);
    expect(candidateRun?.runId).toBe(3);
    expect(baselineRun?.runId).toBe(1);
  });
});

describe("DashboardHtmlGenerator PR Gate & Run Diff integration", () => {
  it("renders the PR Gate & Run Diff tab with valid client-side JavaScript", () => {
    const run = makeRun({ runId: 500 });
    const report: DashboardInsightsReport = {
      generatedAt: "2026-11-15T12:00:00Z",
      orgUrl: "https://dev.azure.com/org",
      project: "DemoProject",
      filter: {
        startDate: "2026-11-01",
        endDate: "2026-11-15",
        planName: "all",
        buildNumber: "all",
        executionSource: "all",
        executionSubSource: "all",
      },
      cacheInfo: {
        totalCachedRuns: 1,
        isDemoData: true,
        cacheFilePath: "/tmp/cache.json",
      },
      kpis: {
        totalRuns: 1,
        pipelineRuns: 1,
        directAdoRuns: 0,
        reporterRuns: 1,
        nativePipelineRuns: 0,
        totalTests: 4,
        pipelineTests: 4,
        directAdoTests: 0,
        automationSharePct: 100,
        runAutomationSharePct: 100,
        overallPassRate: 75,
        pipelinePassRate: 75,
        directAdoPassRate: 0,
        passRateDeltaPct: 0,
        flakyTestCount: 0,
        newRegressionCount: 1,
        recurringFailureGroupCount: 0,
        openLinkedDefectsCount: 0,
        defectCoveragePct: 0,
        avgRunDurationMs: 300000,
        p95RunDurationMs: 300000,
        avgTestDurationMs: 100,
        p95TestDurationMs: 100,
        quarantinedTestCount: 0,
        graduationCandidatesCount: 0,
        overallMttrHours: 0,
        overallMttrRuns: 0,
        overallMtbfHours: 0,
        overallMtbfRuns: 0,
      },
      sourceComparison: {
        pipeline: {
          runs: 1, tests: 4, passed: 3, failed: 1, blocked: 0, notExecuted: 0, other: 0,
          passRate: 75, avgRunDurationMs: 300000, p95RunDurationMs: 300000, avgTestDurationMs: 100, p95TestDurationMs: 100,
        },
        directAdo: {
          runs: 0, tests: 0, passed: 0, failed: 0, blocked: 0, notExecuted: 0, other: 0,
          passRate: 0, avgRunDurationMs: 0, p95RunDurationMs: 0, avgTestDurationMs: 0, p95TestDurationMs: 0,
        },
        subSources: {
          adoTestReporter: {
            runs: 1, tests: 4, passed: 3, failed: 1, blocked: 0, notExecuted: 0, other: 0,
            passRate: 75, avgRunDurationMs: 300000, p95RunDurationMs: 300000, avgTestDurationMs: 100, p95TestDurationMs: 100,
          },
          azurePipeline: {
            runs: 0, tests: 0, passed: 0, failed: 0, blocked: 0, notExecuted: 0, other: 0,
            passRate: 0, avgRunDurationMs: 0, p95RunDurationMs: 0, avgTestDurationMs: 0, p95TestDurationMs: 0,
          },
          directManual: {
            runs: 0, tests: 0, passed: 0, failed: 0, blocked: 0, notExecuted: 0, other: 0,
            passRate: 0, avgRunDurationMs: 0, p95RunDurationMs: 0, avgTestDurationMs: 0, p95TestDurationMs: 0,
          },
        },
      },
      trends: { bucketUnit: "day", buckets: [] },
      planSuiteHealth: [],
      triage: {
        newRegressions: [],
        recurringFailures: [],
        flakyTests: [],
        slowestTests: [],
      },
      availableFilters: { plans: [], builds: [] },
      runs: [run],
    };

    const html = DashboardHtmlGenerator.generateHtml(report);
    expect(html).toContain('id="tabBtn-gate"');
    expect(html).toContain("renderGateDiffTab");
    expect(html).toContain("computeRunDiff");

    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();
    expect(() => new Function(scriptMatch![1])).not.toThrow();
  });
});
