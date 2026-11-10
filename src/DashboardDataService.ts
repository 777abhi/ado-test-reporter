import * as crypto from "crypto";
import { ITestApi } from "azure-devops-node-api/TestApi";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import {
  DashboardCacheData,
  DashboardFilterOptions,
  DashboardInsightsReport,
  DashboardRunRecord,
  DashboardTestResultRecord,
  ExecutionSource,
  ExecutionSubSource,
  FlakyTestInsight,
  IDashboardCacheRepository,
  IDashboardService,
  LinkedDefectRecord,
  NormalizedOutcome,
  PlanSuiteHealthEntry,
  RecurringFailureGroup,
  RegressionInsight,
  SlowTestInsight,
  SourceBreakdownStats,
  TrendBucket,
  QuarantineDashboardSection,
  TestReliabilityMetric,
} from "./interfaces/IDashboardService";
import { ILogger } from "./interfaces/ILogger";
import { DashboardCacheRepository } from "./DashboardCacheRepository";
import { sanitizeForCsv } from "./utils/CsvUtils";
import { escapeWiqlString } from "./utils/WiqlUtils";
import { IQuarantineService } from "./interfaces/IQuarantineService";
import { QuarantineService } from "./QuarantineService";

const TC_ID_REGEX = /TC(\d+)/i;

export class DashboardDataService implements IDashboardService {
  private quarantineService: IQuarantineService;

  constructor(
    private cacheRepo: IDashboardCacheRepository,
    private logger: ILogger,
    private orgUrl: string = "https://dev.azure.com/sample-org",
    private project: string = "SampleProject",
    private testApi?: ITestApi,
    private workItemApi?: IWorkItemTrackingApi,
    private defectType: string = "Task",
    quarantineService?: IQuarantineService
  ) {
    this.quarantineService = quarantineService || new QuarantineService(this.logger);
  }

  static classifyExecutionSource(rawRun: {
    name?: string;
    isAutomated?: boolean;
    build?: { id?: string | number };
    buildConfiguration?: { id?: number; number?: string };
    release?: { id?: number };
    plan?: { name?: string };
    comment?: string;
  }): {
    executionSource: ExecutionSource;
    executionSubSource: ExecutionSubSource;
  } {
    const hasBuildLink = Boolean(
      rawRun.build?.id ||
        rawRun.buildConfiguration?.id ||
        rawRun.release?.id
    );
    const isPipelineOrAutomated = Boolean(rawRun.isAutomated || hasBuildLink);

    if (!isPipelineOrAutomated) {
      return {
        executionSource: "direct_ado",
        executionSubSource: "direct_manual",
      };
    }

    const name = rawRun.name || "";
    const planName = rawRun.plan?.name || "";
    const comment = rawRun.comment || "";

    const isReporterRun =
      /^Run\s+.+\s+-\s+.+/i.test(name) ||
      /ado-test-reporter|AutoPlan-|AutoSuite-/i.test(name) ||
      /ado-test-reporter|AutoPlan-/i.test(planName) ||
      /ADO Test Reporter/i.test(comment);

    return {
      executionSource: "pipeline",
      executionSubSource: isReporterRun ? "ado_test_reporter" : "azure_pipeline",
    };
  }

  static normalizeOutcome(rawOutcome?: string): NormalizedOutcome {
    if (!rawOutcome) return "Other";
    const lower = rawOutcome.toLowerCase();
    if (lower === "passed") return "Passed";
    if (lower === "failed") return "Failed";
    if (lower === "blocked") return "Blocked";
    if (
      lower === "notexecuted" ||
      lower === "not executed" ||
      lower === "inprogress" ||
      lower === "paused"
    ) {
      return "NotExecuted";
    }
    return "Other";
  }

  static computePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1)
    );
    return Math.round(sorted[idx]);
  }

  private generateErrorHash(message: string): string {
    return crypto.createHash("sha256").update(message.trim()).digest("hex");
  }

  seedDemoDataIfEmpty(): DashboardCacheData {
    const current = this.cacheRepo.load();
    if (current.runs && current.runs.length > 0) {
      return current;
    }
    this.logger.log(
      "ℹ️ Dashboard cache is empty. Seeding realistic 28-day sample dataset for offline/demo exploration..."
    );
    const demoRuns = DashboardCacheRepository.generateDemoRuns(
      this.orgUrl,
      this.project
    );
    return this.cacheRepo.upsertRuns(demoRuns, this.orgUrl, this.project, true);
  }

  async syncFromAdo(startDate: Date, endDate: Date): Promise<DashboardCacheData> {
    if (!this.testApi) {
      throw new Error(
        "Azure DevOps Test API client is not initialized. Provide ADO_TOKEN, ADO_ORG_URL, and ADO_PROJECT to sync live runs."
      );
    }

    const baseOrg = this.orgUrl.replace(/\/$/, "");
    this.logger.log(
      `🔄 Syncing ADO Test Runs from ${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}...`
    );

    const rawRunsMap = new Map<number, any>();

    // ADO queryTestRuns limits minLastUpdatedDate..maxLastUpdatedDate to 7 days per call
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    let chunkStart = new Date(startDate.getTime());

    while (chunkStart.getTime() < endDate.getTime()) {
      const chunkEnd = new Date(
        Math.min(endDate.getTime(), chunkStart.getTime() + sevenDaysMs)
      );
      try {
        if (typeof (this.testApi as any).queryTestRuns === "function") {
          const queriedRuns = await (this.testApi as any).queryTestRuns(
            this.project,
            chunkStart,
            chunkEnd
          );
          if (Array.isArray(queriedRuns)) {
            for (const r of queriedRuns) {
              if (r && typeof r.id === "number") {
                rawRunsMap.set(r.id, r);
              }
            }
          }
        }
      } catch (err) {
        this.logger.warn(
          `⚠️ queryTestRuns chunk (${chunkStart.toISOString().slice(0, 10)}..${chunkEnd.toISOString().slice(0, 10)}) fallback: ${(err as Error).message}`
        );
      }
      chunkStart = new Date(chunkEnd.getTime() + 1);
    }

    // Fallback to getTestRuns if queryTestRuns wasn't supported or returned empty
    if (rawRunsMap.size === 0 && typeof this.testApi.getTestRuns === "function") {
      const allRuns = await this.testApi.getTestRuns(this.project);
      for (const r of allRuns || []) {
        if (!r || typeof r.id !== "number") continue;
        const completed = r.completedDate
          ? new Date(r.completedDate)
          : r.startedDate
          ? new Date(r.startedDate)
          : new Date();
        if (completed >= startDate && completed <= endDate) {
          rawRunsMap.set(r.id, r);
        }
      }
    }

    const defectByTestCaseId = await this.fetchOpenDefectsMap(baseOrg);
    const normalizedRuns: DashboardRunRecord[] = [];

    for (const [runId, rawRun] of rawRunsMap.entries()) {
      try {
        const rawResults =
          typeof this.testApi.getTestResults === "function"
            ? await this.testApi.getTestResults(this.project, runId)
            : [];

        const { executionSource, executionSubSource } =
          DashboardDataService.classifyExecutionSource(rawRun);

        const startedDate = rawRun.startedDate
          ? new Date(rawRun.startedDate).toISOString()
          : new Date().toISOString();
        const completedDate = rawRun.completedDate
          ? new Date(rawRun.completedDate).toISOString()
          : startedDate;

        const results: DashboardTestResultRecord[] = (rawResults || []).map(
          (res: any, idx: number) => {
            const title =
              res.testCaseTitle ||
              res.automatedTestName ||
              `TestResult_${res.id || idx + 1}`;
            const match = title.match(TC_ID_REGEX);
            const tcId = res.testCase?.id
              ? String(res.testCase.id)
              : match
              ? match[1]
              : undefined;
            const outcome = DashboardDataService.normalizeOutcome(res.outcome);
            const errorMessage = res.errorMessage ? String(res.errorMessage) : undefined;
            const errorHash = errorMessage
              ? this.generateErrorHash(errorMessage)
              : undefined;
            const durationMs =
              typeof res.durationInMs === "number" && res.durationInMs >= 0
                ? Math.round(res.durationInMs)
                : 0;

            const linkedDefect =
              (tcId && defectByTestCaseId.get(`tc:${tcId}`)) ||
              (errorHash && defectByTestCaseId.get(`hash:${errorHash}`));

            return {
              resultId: Number(res.id || idx + 1),
              runId,
              testCaseId: tcId,
              testCaseTitle: title,
              automatedTestName: res.automatedTestName,
              outcome,
              durationMs,
              errorMessage,
              errorHash,
              completedDate: res.completedDate
                ? new Date(res.completedDate).toISOString()
                : completedDate,
              executionSource,
              executionSubSource,
              testCaseUrl: tcId
                ? `${baseOrg}/${this.project}/_workitems/edit/${tcId}`
                : undefined,
              linkedDefect,
            };
          }
        );

        const totalTests =
          results.length > 0 ? results.length : Number(rawRun.totalTests || 0);
        const passedTests =
          results.length > 0
            ? results.filter((r) => r.outcome === "Passed").length
            : Number(rawRun.passedTests || 0);
        const failedTests =
          results.length > 0
            ? results.filter((r) => r.outcome === "Failed").length
            : Number(rawRun.unanalyzedTests || 0);
        const blockedTests = results.filter((r) => r.outcome === "Blocked").length;
        const notExecutedTests =
          results.length > 0
            ? results.filter((r) => r.outcome === "NotExecuted").length
            : Number(rawRun.notApplicableTests || 0);
        const otherTests = Math.max(
          0,
          totalTests - passedTests - failedTests - blockedTests - notExecutedTests
        );

        const resultsDurationSum = results.reduce((s, r) => s + r.durationMs, 0);
        const runWallClockMs = Math.max(
          0,
          new Date(completedDate).getTime() - new Date(startedDate).getTime()
        );
        const durationMs = resultsDurationSum > 0 ? resultsDurationSum : runWallClockMs;

        const buildId = rawRun.build?.id
          ? Number(rawRun.build.id)
          : rawRun.buildConfiguration?.id
          ? Number(rawRun.buildConfiguration.id)
          : undefined;
        const buildNumber =
          rawRun.buildConfiguration?.number ||
          rawRun.build?.name ||
          (buildId ? String(buildId) : undefined);

        const planId = rawRun.plan?.id ? Number(rawRun.plan.id) : undefined;
        const planName = rawRun.plan?.name || "Unassigned Plan";

        const passRate =
          totalTests > 0 ? Number(((passedTests / totalTests) * 100).toFixed(1)) : 0;

        normalizedRuns.push({
          runId,
          name: rawRun.name || `Run #${runId}`,
          state: rawRun.state || "Completed",
          startedDate,
          completedDate,
          durationMs,
          isAutomated: Boolean(rawRun.isAutomated),
          executionSource,
          executionSubSource,
          planId,
          planName,
          buildId,
          buildNumber,
          releaseId: rawRun.release?.id ? Number(rawRun.release.id) : undefined,
          ownerName: rawRun.owner?.displayName || undefined,
          totalTests,
          passedTests,
          failedTests,
          blockedTests,
          notExecutedTests,
          otherTests,
          passRate,
          runUrl: `${baseOrg}/${this.project}/_testManagement/runs?runId=${runId}`,
          buildUrl: buildId
            ? `${baseOrg}/${this.project}/_build/results?buildId=${buildId}`
            : undefined,
          planUrl: planId
            ? `${baseOrg}/${this.project}/_testPlans/execute?planId=${planId}`
            : undefined,
          results,
        });
      } catch (err) {
        this.logger.warn(
          `⚠️ Failed to process details for Test Run ${runId}: ${(err as Error).message}`
        );
      }
    }

    this.logger.log(`✅ Synced ${normalizedRuns.length} Test Runs into local cache.`);
    return this.cacheRepo.upsertRuns(
      normalizedRuns,
      this.orgUrl,
      this.project,
      false
    );
  }

  private async fetchOpenDefectsMap(
    baseOrg: string
  ): Promise<Map<string, LinkedDefectRecord>> {
    const map = new Map<string, LinkedDefectRecord>();
    if (!this.workItemApi) return map;

    try {
      const escapedType = escapeWiqlString(this.defectType);
      const wiql = {
        query: `
          SELECT [System.Id]
          FROM WorkItems
          WHERE
            [System.TeamProject] = @project
            AND ([System.WorkItemType] = '${escapedType}' OR [System.WorkItemType] = 'Bug' OR [System.WorkItemType] = 'Task')
            AND [System.State] <> 'Closed'
            AND [System.State] <> 'Done'
          ORDER BY [System.ChangedDate] DESC
        `,
      };
      const queryResult = await this.workItemApi.queryByWiql(wiql, {
        project: this.project,
      });
      const ids = (queryResult.workItems || [])
        .map((w) => w.id)
        .filter((id): id is number => typeof id === "number")
        .slice(0, 100);

      if (ids.length === 0 || typeof this.workItemApi.getWorkItems !== "function") {
        return map;
      }

      const items = await this.workItemApi.getWorkItems(ids, [
        "System.Id",
        "System.Title",
        "System.State",
        "System.WorkItemType",
        "System.Tags",
      ]);

      for (const item of items || []) {
        if (!item.id || !item.fields) continue;
        const title = String(item.fields["System.Title"] || "");
        const state = String(item.fields["System.State"] || "Active");
        const workItemType = String(
          item.fields["System.WorkItemType"] || this.defectType
        );
        const tags = String(item.fields["System.Tags"] || "");

        const record: LinkedDefectRecord = {
          workItemId: item.id,
          workItemType,
          title,
          state,
          url: `${baseOrg}/${this.project}/_workitems/edit/${item.id}`,
          isFlakyTagged: /flaky/i.test(tags) || /\[flaky\]/i.test(title),
        };

        const tcMatch = title.match(TC_ID_REGEX);
        if (tcMatch) {
          map.set(`tc:${tcMatch[1]}`, record);
        }

        const hashMatch = tags.match(/ErrorHash:([a-f0-9]{64})/i);
        if (hashMatch) {
          map.set(`hash:${hashMatch[1]}`, record);
        }
      }
    } catch (err) {
      this.logger.warn(
        `⚠️ Could not fetch linked defects for dashboard enrichment: ${(err as Error).message}`
      );
    }

    return map;
  }

  buildReport(filter: DashboardFilterOptions = {}): DashboardInsightsReport {
    const cache = this.cacheRepo.load();
    const allRuns = cache.runs || [];

    // Default date range: if cache has runs, span up to latest run or current date (default 30 days)
    const latestRunTime =
      allRuns.length > 0
        ? Math.max(...allRuns.map((r) => new Date(r.completedDate).getTime()))
        : Date.now();

    const defaultEnd = new Date(Math.max(Date.now(), latestRunTime));
    const defaultStart = new Date(
      defaultEnd.getTime() - 30 * 24 * 60 * 60 * 1000
    );

    const parsedEnd = filter.endDate
      ? this.parseDateBoundary(filter.endDate, true)
      : defaultEnd;
    const parsedStart = filter.startDate
      ? this.parseDateBoundary(filter.startDate, false)
      : defaultStart;

    const normalizedFilter: Required<DashboardFilterOptions> = {
      startDate: parsedStart.toISOString().slice(0, 10),
      endDate: parsedEnd.toISOString().slice(0, 10),
      planName: filter.planName || "all",
      buildNumber: filter.buildNumber || "all",
      executionSource: filter.executionSource || "all",
      executionSubSource: filter.executionSubSource || "all",
    };

    const filteredRuns = this.filterRuns(
      allRuns,
      parsedStart,
      parsedEnd,
      normalizedFilter
    );

    // Previous period of identical duration for Period-over-Period Pass Rate Delta
    const windowDurationMs = Math.max(
      24 * 60 * 60 * 1000,
      parsedEnd.getTime() - parsedStart.getTime()
    );
    const prevEnd = new Date(parsedStart.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - windowDurationMs);
    const prevRuns = this.filterRuns(
      allRuns,
      prevStart,
      prevEnd,
      normalizedFilter
    );

    const pipelineRunsList = filteredRuns.filter(
      (r) => r.executionSource === "pipeline"
    );
    const directAdoRunsList = filteredRuns.filter(
      (r) => r.executionSource === "direct_ado"
    );
    const reporterRunsList = filteredRuns.filter(
      (r) => r.executionSubSource === "ado_test_reporter"
    );
    const nativePipelineRunsList = filteredRuns.filter(
      (r) => r.executionSubSource === "azure_pipeline"
    );

    const pipelineStats = this.computeSourceStats(pipelineRunsList);
    const directAdoStats = this.computeSourceStats(directAdoRunsList);
    const reporterStats = this.computeSourceStats(reporterRunsList);
    const nativePipelineStats = this.computeSourceStats(nativePipelineRunsList);
    const overallStats = this.computeSourceStats(filteredRuns);
    const prevOverallStats = this.computeSourceStats(prevRuns);

    const passRateDeltaPct =
      prevOverallStats.tests > 0
        ? Number((overallStats.passRate - prevOverallStats.passRate).toFixed(1))
        : 0;

    const automationSharePct =
      overallStats.tests > 0
        ? Number(((pipelineStats.tests / overallStats.tests) * 100).toFixed(1))
        : 0;
    const runAutomationSharePct =
      overallStats.runs > 0
        ? Number(((pipelineStats.runs / overallStats.runs) * 100).toFixed(1))
        : 0;

    // Triage & Flaky & Regression & Slowest calculations
    const flakyTests = this.computeFlakyTests(filteredRuns);
    const newRegressions = this.computeNewRegressions(filteredRuns);
    const recurringFailures = this.computeRecurringFailures(filteredRuns);
    const slowestTests = this.computeSlowestTests(filteredRuns);

    // Open Linked Defects & Defect Coverage
    const uniqueDefectIds = new Set<number>();
    const failingTestKeys = new Set<string>();
    const coveredFailingTestKeys = new Set<string>();

    for (const run of filteredRuns) {
      for (const res of run.results) {
        if (res.linkedDefect && res.linkedDefect.state !== "Closed" && res.linkedDefect.state !== "Done") {
          uniqueDefectIds.add(res.linkedDefect.workItemId);
        }
        if (res.outcome === "Failed") {
          const key = res.testCaseId || res.testCaseTitle;
          failingTestKeys.add(key);
          if (res.linkedDefect) {
            coveredFailingTestKeys.add(key);
          }
        }
      }
    }

    const defectCoveragePct =
      failingTestKeys.size > 0
        ? Number(
            ((coveredFailingTestKeys.size / failingTestKeys.size) * 100).toFixed(1)
          )
        : 100;

    // Trends
    const trends = this.computeTrendBuckets(
      filteredRuns,
      parsedStart,
      parsedEnd
    );

    // Plan & Suite Health
    const planSuiteHealth = this.computePlanSuiteHealth(
      filteredRuns,
      flakyTests
    );

    // Quarantine & Reliability Metrics (MTTR & MTBF)
    const quarantine = this.computeReliabilityAndQuarantineMetrics(filteredRuns);

    // Available filter options from all cached runs
    const plansSet = new Set<string>();
    const buildsSet = new Set<string>();
    for (const r of allRuns) {
      if (r.planName) plansSet.add(r.planName);
      if (r.buildNumber) buildsSet.add(r.buildNumber);
    }

    return {
      generatedAt: new Date().toISOString(),
      orgUrl: cache.orgUrl || this.orgUrl,
      project: cache.project || this.project,
      filter: normalizedFilter,
      cacheInfo: {
        lastSyncedAt: cache.lastSyncedAt,
        totalCachedRuns: allRuns.length,
        isDemoData: Boolean(cache.isDemoData),
        cacheFilePath: this.cacheRepo.getCacheFilePath(),
      },
      kpis: {
        totalRuns: overallStats.runs,
        pipelineRuns: pipelineStats.runs,
        directAdoRuns: directAdoStats.runs,
        reporterRuns: reporterStats.runs,
        nativePipelineRuns: nativePipelineStats.runs,
        totalTests: overallStats.tests,
        pipelineTests: pipelineStats.tests,
        directAdoTests: directAdoStats.tests,
        automationSharePct,
        runAutomationSharePct,
        overallPassRate: overallStats.passRate,
        pipelinePassRate: pipelineStats.passRate,
        directAdoPassRate: directAdoStats.passRate,
        passRateDeltaPct,
        flakyTestCount: flakyTests.length,
        newRegressionCount: newRegressions.length,
        recurringFailureGroupCount: recurringFailures.length,
        openLinkedDefectsCount: uniqueDefectIds.size,
        defectCoveragePct,
        avgRunDurationMs: overallStats.avgRunDurationMs,
        p95RunDurationMs: overallStats.p95RunDurationMs,
        avgTestDurationMs: overallStats.avgTestDurationMs,
        p95TestDurationMs: overallStats.p95TestDurationMs,
        quarantinedTestCount: quarantine.totalQuarantined,
        graduationCandidatesCount: quarantine.graduationCandidatesCount,
        overallMttrHours: quarantine.overallMttrHours,
        overallMttrRuns: quarantine.overallMttrRuns,
        overallMtbfHours: quarantine.overallMtbfHours,
        overallMtbfRuns: quarantine.overallMtbfRuns,
      },
      sourceComparison: {
        pipeline: pipelineStats,
        directAdo: directAdoStats,
        subSources: {
          adoTestReporter: reporterStats,
          azurePipeline: nativePipelineStats,
          directManual: directAdoStats,
        },
      },
      trends,
      planSuiteHealth,
      triage: {
        newRegressions,
        recurringFailures,
        flakyTests,
        slowestTests,
      },
      quarantine,
      availableFilters: {
        plans: Array.from(plansSet).sort(),
        builds: Array.from(buildsSet).sort(),
      },
      runs: filteredRuns,
    };
  }

  private parseDateBoundary(dateStr: string, isEndOfDay: boolean): Date {
    const trimmed = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(
        isEndOfDay ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`
      );
    }
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      return isEndOfDay ? new Date() : new Date(Date.now() - 30 * 86400000);
    }
    return parsed;
  }

  private filterRuns(
    runs: DashboardRunRecord[],
    start: Date,
    end: Date,
    filter: Required<DashboardFilterOptions>
  ): DashboardRunRecord[] {
    return runs.filter((run) => {
      const completed = new Date(run.completedDate);
      if (completed < start || completed > end) return false;

      if (
        filter.planName !== "all" &&
        (run.planName || "").toLowerCase() !== filter.planName.toLowerCase()
      ) {
        return false;
      }

      if (
        filter.buildNumber !== "all" &&
        (run.buildNumber || "").toLowerCase() !== filter.buildNumber.toLowerCase()
      ) {
        return false;
      }

      if (
        filter.executionSource !== "all" &&
        run.executionSource !== filter.executionSource
      ) {
        return false;
      }

      if (
        filter.executionSubSource !== "all" &&
        run.executionSubSource !== filter.executionSubSource
      ) {
        return false;
      }

      return true;
    });
  }

  private computeSourceStats(runs: DashboardRunRecord[]): SourceBreakdownStats {
    let tests = 0;
    let passed = 0;
    let failed = 0;
    let blocked = 0;
    let notExecuted = 0;
    let other = 0;
    const runDurations: number[] = [];
    const testDurations: number[] = [];

    for (const r of runs) {
      tests += r.totalTests;
      passed += r.passedTests;
      failed += r.failedTests;
      blocked += r.blockedTests;
      notExecuted += r.notExecutedTests;
      other += r.otherTests;
      runDurations.push(r.durationMs);
      for (const res of r.results) {
        testDurations.push(res.durationMs);
      }
    }

    const passRate =
      tests > 0 ? Number(((passed / tests) * 100).toFixed(1)) : 0;
    const avgRunDurationMs =
      runDurations.length > 0
        ? Math.round(
            runDurations.reduce((a, b) => a + b, 0) / runDurations.length
          )
        : 0;
    const p95RunDurationMs = DashboardDataService.computePercentile(
      runDurations,
      95
    );
    const avgTestDurationMs =
      testDurations.length > 0
        ? Math.round(
            testDurations.reduce((a, b) => a + b, 0) / testDurations.length
          )
        : 0;
    const p95TestDurationMs = DashboardDataService.computePercentile(
      testDurations,
      95
    );

    return {
      runs: runs.length,
      tests,
      passed,
      failed,
      blocked,
      notExecuted,
      other,
      passRate,
      avgRunDurationMs,
      p95RunDurationMs,
      avgTestDurationMs,
      p95TestDurationMs,
    };
  }

  private computeFlakyTests(runs: DashboardRunRecord[]): FlakyTestInsight[] {
    // Sort runs chronologically oldest -> newest to track outcome sequence
    const chronologicalRuns = [...runs].sort(
      (a, b) =>
        new Date(a.completedDate).getTime() - new Date(b.completedDate).getTime()
    );

    const historyByTest = new Map<
      string,
      {
        testCaseId?: string;
        testCaseTitle: string;
        outcomes: NormalizedOutcome[];
        pipelineExecs: number;
        directAdoExecs: number;
        testCaseUrl?: string;
        linkedDefect?: LinkedDefectRecord;
      }
    >();

    for (const run of chronologicalRuns) {
      for (const res of run.results) {
        const key = res.testCaseId
          ? `TC_${res.testCaseId}`
          : `TITLE_${res.testCaseTitle}`;
        let entry = historyByTest.get(key);
        if (!entry) {
          entry = {
            testCaseId: res.testCaseId,
            testCaseTitle: res.testCaseTitle,
            outcomes: [],
            pipelineExecs: 0,
            directAdoExecs: 0,
            testCaseUrl: res.testCaseUrl,
            linkedDefect: res.linkedDefect,
          };
          historyByTest.set(key, entry);
        }
        entry.outcomes.push(res.outcome);
        if (res.executionSource === "pipeline") {
          entry.pipelineExecs++;
        } else {
          entry.directAdoExecs++;
        }
        if (res.linkedDefect) {
          entry.linkedDefect = res.linkedDefect;
        }
      }
    }

    const flakyList: FlakyTestInsight[] = [];

    for (const [key, entry] of historyByTest.entries()) {
      const passCount = entry.outcomes.filter((o) => o === "Passed").length;
      const failCount = entry.outcomes.filter((o) => o === "Failed").length;
      if (passCount === 0 || failCount === 0) continue;

      // Count transitions between Passed and Failed
      const passFailSeq = entry.outcomes.filter(
        (o) => o === "Passed" || o === "Failed"
      );
      let oscillationCount = 0;
      for (let i = 1; i < passFailSeq.length; i++) {
        if (passFailSeq[i] !== passFailSeq[i - 1]) {
          oscillationCount++;
        }
      }

      const flipRatePct =
        passFailSeq.length > 1
          ? Number(
              ((oscillationCount / (passFailSeq.length - 1)) * 100).toFixed(1)
            )
          : 0;

      flakyList.push({
        testKey: key,
        testCaseId: entry.testCaseId,
        testCaseTitle: entry.testCaseTitle,
        totalExecutions: entry.outcomes.length,
        passCount,
        failCount,
        oscillationCount,
        flipRatePct,
        pipelineExecutions: entry.pipelineExecs,
        directAdoExecutions: entry.directAdoExecs,
        latestOutcome: entry.outcomes[entry.outcomes.length - 1],
        outcomeSequence: entry.outcomes.slice(-10),
        testCaseUrl: entry.testCaseUrl,
        linkedDefect: entry.linkedDefect,
      });
    }

    return flakyList.sort(
      (a, b) =>
        b.oscillationCount - a.oscillationCount || b.failCount - a.failCount
    );
  }

  private computeReliabilityAndQuarantineMetrics(
    runs: DashboardRunRecord[]
  ): QuarantineDashboardSection {
    const chronologicalRuns = [...runs].sort(
      (a, b) =>
        new Date(a.completedDate || a.startedDate).getTime() -
        new Date(b.completedDate || b.startedDate).getTime()
    );

    const testMap = new Map<
      string,
      {
        testKey: string;
        testCaseId?: string;
        testCaseTitle: string;
        executions: { completedDate: number; outcome: NormalizedOutcome; runId: number }[];
      }
    >();

    for (const run of chronologicalRuns) {
      const runTime = new Date(run.completedDate || run.startedDate).getTime();
      for (const res of run.results) {
        const key = res.testCaseId ? `TC${res.testCaseId}` : (res.testCaseTitle || String(res.resultId));
        let entry = testMap.get(key);
        if (!entry) {
          entry = {
            testKey: key,
            testCaseId: res.testCaseId,
            testCaseTitle: res.testCaseTitle,
            executions: [],
          };
          testMap.set(key, entry);
        }
        const execTime = res.completedDate ? new Date(res.completedDate).getTime() : runTime;
        entry.executions.push({
          completedDate: execTime,
          outcome: res.outcome,
          runId: run.runId,
        });
      }
    }

    const reliabilityList: TestReliabilityMetric[] = [];
    let totalRecoveryDurationHours = 0;
    let totalRecoveryRuns = 0;
    let totalRecoveryEpisodes = 0;

    let totalTbfDurationHours = 0;
    let totalTbfRuns = 0;
    let totalTbfEpisodes = 0;

    const activeQuarantined = this.quarantineService
      ? this.quarantineService.listActiveQuarantined()
      : [];
    const graduationCandidates = this.quarantineService
      ? this.quarantineService.getGraduationCandidates()
      : [];

    for (const [key, test] of testMap.entries()) {
      let failCount = 0;
      let passCount = 0;
      let recoveryCount = 0;
      let flipCount = 0;

      let inFailureEpisode = false;
      let firstFailureTime = 0;
      let runsInEpisode = 0;
      let lastRecoveryTime = test.executions.length > 0 ? test.executions[0].completedDate : 0;
      let runsSinceLastRecovery = 0;

      const testRecoveryHours: number[] = [];
      const testRecoveryRuns: number[] = [];
      const testTbfHours: number[] = [];
      const testTbfRuns: number[] = [];

      let prevOutcome: NormalizedOutcome | null = null;

      for (const exec of test.executions) {
        if (exec.outcome === "Passed") passCount++;
        if (exec.outcome === "Failed") failCount++;

        if (prevOutcome !== null && prevOutcome !== exec.outcome) {
          if (
            (prevOutcome === "Passed" && exec.outcome === "Failed") ||
            (prevOutcome === "Failed" && exec.outcome === "Passed")
          ) {
            flipCount++;
          }
        }

        if (exec.outcome === "Failed") {
          if (!inFailureEpisode) {
            inFailureEpisode = true;
            firstFailureTime = exec.completedDate;
            runsInEpisode = 1;

            if (lastRecoveryTime > 0 && exec.completedDate > lastRecoveryTime) {
              const tbfHours = Math.max(0.1, (exec.completedDate - lastRecoveryTime) / (1000 * 3600));
              testTbfHours.push(tbfHours);
              testTbfRuns.push(Math.max(1, runsSinceLastRecovery));
              totalTbfDurationHours += tbfHours;
              totalTbfRuns += Math.max(1, runsSinceLastRecovery);
              totalTbfEpisodes++;
            }
          } else {
            runsInEpisode++;
          }
        } else if (exec.outcome === "Passed") {
          if (inFailureEpisode) {
            inFailureEpisode = false;
            recoveryCount++;
            const ttrHours = Math.max(0.1, (exec.completedDate - firstFailureTime) / (1000 * 3600));
            testRecoveryHours.push(ttrHours);
            testRecoveryRuns.push(runsInEpisode);
            totalRecoveryDurationHours += ttrHours;
            totalRecoveryRuns += runsInEpisode;
            totalRecoveryEpisodes++;

            lastRecoveryTime = exec.completedDate;
            runsSinceLastRecovery = 0;
          } else {
            runsSinceLastRecovery++;
          }
        }

        prevOutcome = exec.outcome;
      }

      const totalExec = test.executions.length;
      const avgMttrHours =
        testRecoveryHours.length > 0
          ? Number((testRecoveryHours.reduce((a, b) => a + b, 0) / testRecoveryHours.length).toFixed(1))
          : 0;
      const avgMttrRuns =
        testRecoveryRuns.length > 0
          ? Number((testRecoveryRuns.reduce((a, b) => a + b, 0) / testRecoveryRuns.length).toFixed(1))
          : 0;
      const avgMtbfHours =
        testTbfHours.length > 0
          ? Number((testTbfHours.reduce((a, b) => a + b, 0) / testTbfHours.length).toFixed(1))
          : 0;
      const avgMtbfRuns =
        testTbfRuns.length > 0
          ? Number((testTbfRuns.reduce((a, b) => a + b, 0) / testTbfRuns.length).toFixed(1))
          : 0;

      const failRatio = totalExec > 0 ? (failCount / totalExec) * 100 : 0;
      const flipRatio = totalExec > 0 ? (flipCount / totalExec) * 100 : 0;
      const stabilityScorePct = Math.round(
        Math.max(0, Math.min(100, 100 - (failRatio * 0.6 + flipRatio * 0.4)))
      );

      const isQuarantined = this.quarantineService
        ? this.quarantineService.isQuarantined(test.testCaseId, test.testCaseTitle)
        : false;
      const quarantineRecord = this.quarantineService
        ? this.quarantineService.getQuarantinedTest(test.testCaseId, test.testCaseTitle)
        : undefined;

      const isReadyForGraduation = Boolean(
        quarantineRecord &&
          quarantineRecord.status === "active" &&
          quarantineRecord.consecutivePasses >= quarantineRecord.healingThreshold
      );

      reliabilityList.push({
        testKey: key,
        testCaseId: test.testCaseId,
        testCaseTitle: test.testCaseTitle,
        totalExecutions: totalExec,
        failCount,
        passCount,
        recoveryCount,
        mttrHours: avgMttrHours,
        mttrRuns: avgMttrRuns,
        mtbfHours: avgMtbfHours,
        mtbfRuns: avgMtbfRuns,
        stabilityScorePct,
        isQuarantined,
        quarantineRecord,
        isReadyForGraduation,
      });
    }

    reliabilityList.sort((a, b) => {
      if (a.isQuarantined !== b.isQuarantined) return a.isQuarantined ? -1 : 1;
      return a.stabilityScorePct - b.stabilityScorePct;
    });

    const overallMttrHours =
      totalRecoveryEpisodes > 0
        ? Number((totalRecoveryDurationHours / totalRecoveryEpisodes).toFixed(1))
        : 0;
    const overallMttrRuns =
      totalRecoveryEpisodes > 0
        ? Number((totalRecoveryRuns / totalRecoveryEpisodes).toFixed(1))
        : 0;
    const overallMtbfHours =
      totalTbfEpisodes > 0
        ? Number((totalTbfDurationHours / totalTbfEpisodes).toFixed(1))
        : 0;
    const overallMtbfRuns =
      totalTbfEpisodes > 0
        ? Number((totalTbfRuns / totalTbfEpisodes).toFixed(1))
        : 0;

    return {
      totalQuarantined: activeQuarantined.length,
      graduationCandidatesCount: graduationCandidates.length,
      overallMttrHours,
      overallMttrRuns,
      overallMtbfHours,
      overallMtbfRuns,
      activeQuarantined,
      graduationCandidates,
      reliabilityLeaderboard: reliabilityList,
    };
  }

  private computeNewRegressions(runs: DashboardRunRecord[]): RegressionInsight[] {
    // Chronological oldest -> newest
    const chronologicalRuns = [...runs].sort(
      (a, b) =>
        new Date(a.completedDate).getTime() - new Date(b.completedDate).getTime()
    );

    const execsByTest = new Map<
      string,
      Array<{
        run: DashboardRunRecord;
        res: DashboardTestResultRecord;
      }>
    >();

    for (const run of chronologicalRuns) {
      for (const res of run.results) {
        const key = res.testCaseId
          ? `TC_${res.testCaseId}`
          : `TITLE_${res.testCaseTitle}`;
        const list = execsByTest.get(key) || [];
        list.push({ run, res });
        execsByTest.set(key, list);
      }
    }

    const regressions: RegressionInsight[] = [];

    for (const [, history] of execsByTest.entries()) {
      if (history.length === 0) continue;
      const latest = history[history.length - 1];
      if (latest.res.outcome !== "Failed") continue;

      const previousPassedCount = history
        .slice(0, -1)
        .filter((h) => h.res.outcome === "Passed").length;

      // Count trailing consecutive failures
      let consecutiveFailures = 0;
      let failingSinceDate = latest.run.completedDate;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].res.outcome === "Failed") {
          consecutiveFailures++;
          failingSinceDate = history[i].run.completedDate;
        } else if (history[i].res.outcome === "Passed") {
          break;
        }
      }

      regressions.push({
        testCaseId: latest.res.testCaseId || "Unlinked",
        testCaseTitle: latest.res.testCaseTitle,
        latestRunId: latest.run.runId,
        latestRunName: latest.run.name,
        latestCompletedDate: latest.run.completedDate,
        previousPassedCount,
        consecutiveFailures,
        failingSinceDate,
        errorMessage: latest.res.errorMessage,
        executionSource: latest.res.executionSource,
        executionSubSource: latest.res.executionSubSource,
        testCaseUrl: latest.res.testCaseUrl,
        runUrl: latest.run.runUrl,
        linkedDefect: latest.res.linkedDefect,
      });
    }

    return regressions.sort(
      (a, b) =>
        new Date(b.latestCompletedDate).getTime() -
        new Date(a.latestCompletedDate).getTime()
    );
  }

  private computeRecurringFailures(
    runs: DashboardRunRecord[]
  ): RecurringFailureGroup[] {
    const groups = new Map<
      string,
      {
        errorHash: string;
        errorSnippet: string;
        occurrences: number;
        tcIds: Set<string>;
        tcTitles: Set<string>;
        pipelineOccurrences: number;
        directAdoOccurrences: number;
        latestRunId: number;
        latestFailureDate: string;
        sampleRunUrl: string;
        linkedDefect?: LinkedDefectRecord;
      }
    >();

    for (const run of runs) {
      for (const res of run.results) {
        if (res.outcome !== "Failed") continue;
        const rawErr =
          res.errorMessage || `Unspecified failure in ${res.testCaseTitle}`;
        const hash = res.errorHash || this.generateErrorHash(rawErr);

        let group = groups.get(hash);
        if (!group) {
          group = {
            errorHash: hash,
            errorSnippet: rawErr.slice(0, 220),
            occurrences: 0,
            tcIds: new Set<string>(),
            tcTitles: new Set<string>(),
            pipelineOccurrences: 0,
            directAdoOccurrences: 0,
            latestRunId: run.runId,
            latestFailureDate: run.completedDate,
            sampleRunUrl: run.runUrl,
            linkedDefect: res.linkedDefect,
          };
          groups.set(hash, group);
        }

        group.occurrences++;
        if (res.testCaseId) group.tcIds.add(res.testCaseId);
        group.tcTitles.add(res.testCaseTitle);

        if (res.executionSource === "pipeline") {
          group.pipelineOccurrences++;
        } else {
          group.directAdoOccurrences++;
        }

        if (
          new Date(run.completedDate).getTime() >=
          new Date(group.latestFailureDate).getTime()
        ) {
          group.latestFailureDate = run.completedDate;
          group.latestRunId = run.runId;
          group.sampleRunUrl = run.runUrl;
        }

        if (res.linkedDefect && !group.linkedDefect) {
          group.linkedDefect = res.linkedDefect;
        }
      }
    }

    return Array.from(groups.values())
      .map((g) => ({
        errorHash: g.errorHash,
        errorSnippet: g.errorSnippet,
        occurrences: g.occurrences,
        affectedTestCaseIds: Array.from(g.tcIds),
        affectedTestTitles: Array.from(g.tcTitles),
        pipelineOccurrences: g.pipelineOccurrences,
        directAdoOccurrences: g.directAdoOccurrences,
        latestRunId: g.latestRunId,
        latestFailureDate: g.latestFailureDate,
        sampleRunUrl: g.sampleRunUrl,
        linkedDefect: g.linkedDefect,
      }))
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  private computeSlowestTests(runs: DashboardRunRecord[]): SlowTestInsight[] {
    const map = new Map<
      string,
      {
        testCaseId?: string;
        testCaseTitle: string;
        durations: number[];
        executionSource: ExecutionSource;
        executionSubSource: ExecutionSubSource;
        latestRunId: number;
        runUrl: string;
        testCaseUrl?: string;
      }
    >();

    for (const run of runs) {
      for (const res of run.results) {
        const key = res.testCaseId
          ? `TC_${res.testCaseId}`
          : `TITLE_${res.testCaseTitle}`;
        let entry = map.get(key);
        if (!entry) {
          entry = {
            testCaseId: res.testCaseId,
            testCaseTitle: res.testCaseTitle,
            durations: [],
            executionSource: res.executionSource,
            executionSubSource: res.executionSubSource,
            latestRunId: run.runId,
            runUrl: run.runUrl,
            testCaseUrl: res.testCaseUrl,
          };
          map.set(key, entry);
        }
        entry.durations.push(res.durationMs);
      }
    }

    const list: SlowTestInsight[] = [];
    for (const [key, entry] of map.entries()) {
      const maxDurationMs = Math.max(...entry.durations);
      const p95DurationMs = DashboardDataService.computePercentile(
        entry.durations,
        95
      );
      const avgDurationMs = Math.round(
        entry.durations.reduce((a, b) => a + b, 0) / entry.durations.length
      );
      list.push({
        testKey: key,
        testCaseId: entry.testCaseId,
        testCaseTitle: entry.testCaseTitle,
        executions: entry.durations.length,
        maxDurationMs,
        p95DurationMs,
        avgDurationMs,
        executionSource: entry.executionSource,
        executionSubSource: entry.executionSubSource,
        latestRunId: entry.latestRunId,
        runUrl: entry.runUrl,
        testCaseUrl: entry.testCaseUrl,
      });
    }

    return list.sort((a, b) => b.p95DurationMs - a.p95DurationMs).slice(0, 20);
  }

  private computeTrendBuckets(
    runs: DashboardRunRecord[],
    start: Date,
    end: Date
  ): { bucketUnit: "day" | "week"; buckets: TrendBucket[] } {
    const spanDays = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
    );
    const bucketUnit: "day" | "week" = spanDays > 35 ? "week" : "day";

    const bucketMap = new Map<
      string,
      {
        label: string;
        bucketStart: string;
        bucketEnd: string;
        pipelineRuns: number;
        directAdoRuns: number;
        reporterRuns: number;
        nativePipelineRuns: number;
        pipelineTests: number;
        directAdoTests: number;
        pipelinePassed: number;
        pipelineFailed: number;
        directAdoPassed: number;
        directAdoFailed: number;
        runDurations: number[];
      }
    >();

    // Pre-seed buckets across the date window so charts show continuous timelines
    const stepDays = bucketUnit === "week" ? 7 : 1;
    let cursor = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
    );
    const endDay = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
    );

    while (cursor.getTime() <= endDay.getTime()) {
      const key = cursor.toISOString().slice(0, 10);
      const bucketEndDate = new Date(
        cursor.getTime() + (stepDays - 1) * 86400000
      );
      const label =
        bucketUnit === "week"
          ? `Wk ${key.slice(5)}`
          : key.slice(5); // MM-DD
      bucketMap.set(key, {
        label,
        bucketStart: key,
        bucketEnd: bucketEndDate.toISOString().slice(0, 10),
        pipelineRuns: 0,
        directAdoRuns: 0,
        reporterRuns: 0,
        nativePipelineRuns: 0,
        pipelineTests: 0,
        directAdoTests: 0,
        pipelinePassed: 0,
        pipelineFailed: 0,
        directAdoPassed: 0,
        directAdoFailed: 0,
        runDurations: [],
      });
      cursor = new Date(cursor.getTime() + stepDays * 86400000);
    }

    const bucketKeys = Array.from(bucketMap.keys()).sort();

    for (const run of runs) {
      const dateIso = new Date(run.completedDate).toISOString().slice(0, 10);
      let targetKey = dateIso;
      if (bucketUnit === "week" && bucketKeys.length > 0) {
        // Find latest bucketStart <= dateIso
        targetKey =
          bucketKeys.filter((k) => k <= dateIso).pop() || bucketKeys[0];
      }
      let bucket = bucketMap.get(targetKey);
      if (!bucket) {
        bucket = {
          label: targetKey.slice(5),
          bucketStart: targetKey,
          bucketEnd: targetKey,
          pipelineRuns: 0,
          directAdoRuns: 0,
          reporterRuns: 0,
          nativePipelineRuns: 0,
          pipelineTests: 0,
          directAdoTests: 0,
          pipelinePassed: 0,
          pipelineFailed: 0,
          directAdoPassed: 0,
          directAdoFailed: 0,
          runDurations: [],
        };
        bucketMap.set(targetKey, bucket);
      }

      bucket.runDurations.push(run.durationMs);
      if (run.executionSource === "pipeline") {
        bucket.pipelineRuns++;
        bucket.pipelineTests += run.totalTests;
        bucket.pipelinePassed += run.passedTests;
        bucket.pipelineFailed += run.failedTests;
        if (run.executionSubSource === "ado_test_reporter") {
          bucket.reporterRuns++;
        } else {
          bucket.nativePipelineRuns++;
        }
      } else {
        bucket.directAdoRuns++;
        bucket.directAdoTests += run.totalTests;
        bucket.directAdoPassed += run.passedTests;
        bucket.directAdoFailed += run.failedTests;
      }
    }

    const buckets: TrendBucket[] = Array.from(bucketMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, b]) => {
        const totalTests = b.pipelineTests + b.directAdoTests;
        const totalPassed = b.pipelinePassed + b.directAdoPassed;
        const overallPassRate =
          totalTests > 0
            ? Number(((totalPassed / totalTests) * 100).toFixed(1))
            : 0;
        const pipelinePassRate =
          b.pipelineTests > 0
            ? Number(((b.pipelinePassed / b.pipelineTests) * 100).toFixed(1))
            : 0;
        const directAdoPassRate =
          b.directAdoTests > 0
            ? Number(((b.directAdoPassed / b.directAdoTests) * 100).toFixed(1))
            : 0;
        const avgRunDurationMs =
          b.runDurations.length > 0
            ? Math.round(
                b.runDurations.reduce((x, y) => x + y, 0) /
                  b.runDurations.length
              )
            : 0;

        return {
          label: b.label,
          bucketStart: b.bucketStart,
          bucketEnd: b.bucketEnd,
          pipelineRuns: b.pipelineRuns,
          directAdoRuns: b.directAdoRuns,
          reporterRuns: b.reporterRuns,
          nativePipelineRuns: b.nativePipelineRuns,
          pipelineTests: b.pipelineTests,
          directAdoTests: b.directAdoTests,
          pipelinePassed: b.pipelinePassed,
          pipelineFailed: b.pipelineFailed,
          directAdoPassed: b.directAdoPassed,
          directAdoFailed: b.directAdoFailed,
          overallPassRate,
          pipelinePassRate,
          directAdoPassRate,
          avgRunDurationMs,
        };
      });

    return { bucketUnit, buckets };
  }

  private computePlanSuiteHealth(
    runs: DashboardRunRecord[],
    flakyTests: FlakyTestInsight[]
  ): PlanSuiteHealthEntry[] {
    const flakyKeySet = new Set<string>(
      flakyTests.map((f) =>
        f.testCaseId ? `TC_${f.testCaseId}` : `TITLE_${f.testCaseTitle}`
      )
    );

    const map = new Map<
      string,
      {
        planName: string;
        suiteName: string;
        totalRuns: number;
        pipelineRuns: number;
        directAdoRuns: number;
        totalTests: number;
        pipelineTests: number;
        directAdoTests: number;
        passedTests: number;
        failedTests: number;
        flakyKeys: Set<string>;
      }
    >();

    for (const run of runs) {
      const planName = run.planName || "Unassigned Plan";
      const suiteName = run.suiteName || "Default Suite";
      const key = `${planName}:::${suiteName}`;

      let entry = map.get(key);
      if (!entry) {
        entry = {
          planName,
          suiteName,
          totalRuns: 0,
          pipelineRuns: 0,
          directAdoRuns: 0,
          totalTests: 0,
          pipelineTests: 0,
          directAdoTests: 0,
          passedTests: 0,
          failedTests: 0,
          flakyKeys: new Set<string>(),
        };
        map.set(key, entry);
      }

      entry.totalRuns++;
      entry.totalTests += run.totalTests;
      entry.passedTests += run.passedTests;
      entry.failedTests += run.failedTests;

      if (run.executionSource === "pipeline") {
        entry.pipelineRuns++;
        entry.pipelineTests += run.totalTests;
      } else {
        entry.directAdoRuns++;
        entry.directAdoTests += run.totalTests;
      }

      for (const res of run.results) {
        const tKey = res.testCaseId
          ? `TC_${res.testCaseId}`
          : `TITLE_${res.testCaseTitle}`;
        if (flakyKeySet.has(tKey)) {
          entry.flakyKeys.add(tKey);
        }
      }
    }

    return Array.from(map.values())
      .map((e) => ({
        planName: e.planName,
        suiteName: e.suiteName,
        totalRuns: e.totalRuns,
        pipelineRuns: e.pipelineRuns,
        directAdoRuns: e.directAdoRuns,
        totalTests: e.totalTests,
        pipelineTests: e.pipelineTests,
        directAdoTests: e.directAdoTests,
        passedTests: e.passedTests,
        failedTests: e.failedTests,
        passRate:
          e.totalTests > 0
            ? Number(((e.passedTests / e.totalTests) * 100).toFixed(1))
            : 0,
        flakyCount: e.flakyKeys.size,
      }))
      .sort((a, b) => b.totalTests - a.totalTests);
  }

  exportToCsv(report: DashboardInsightsReport): string {
    const headers = [
      "RunId",
      "RunName",
      "CompletedDate",
      "ExecutionSource",
      "ExecutionSubSource",
      "PlanName",
      "SuiteName",
      "BuildNumber",
      "TestCaseId",
      "TestCaseTitle",
      "Outcome",
      "DurationMs",
      "LinkedDefectId",
      "LinkedDefectState",
      "ErrorMessage",
      "RunUrl",
    ];

    const escapeCsvCell = (raw: string | number | undefined): string => {
      if (raw === undefined || raw === null) return "";
      const str = sanitizeForCsv(String(raw));
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows: string[] = [headers.join(",")];

    for (const run of report.runs) {
      if (run.results.length === 0) {
        rows.push(
          [
            run.runId,
            run.name,
            run.completedDate,
            run.executionSource,
            run.executionSubSource,
            run.planName || "",
            run.suiteName || "",
            run.buildNumber || "",
            "",
            "(Run Summary Only)",
            run.failedTests > 0 ? "Failed" : "Passed",
            run.durationMs,
            "",
            "",
            "",
            run.runUrl,
          ]
            .map(escapeCsvCell)
            .join(",")
        );
        continue;
      }

      for (const res of run.results) {
        rows.push(
          [
            run.runId,
            run.name,
            res.completedDate || run.completedDate,
            res.executionSource,
            res.executionSubSource,
            run.planName || "",
            run.suiteName || "",
            run.buildNumber || "",
            res.testCaseId || "",
            res.testCaseTitle,
            res.outcome,
            res.durationMs,
            res.linkedDefect?.workItemId || "",
            res.linkedDefect?.state || "",
            res.errorMessage || "",
            run.runUrl,
          ]
            .map(escapeCsvCell)
            .join(",")
        );
      }
    }

    return rows.join("\n");
  }

  exportToMarkdown(report: DashboardInsightsReport): string {
    const { kpis, filter, sourceComparison, triage } = report;
    const lines: string[] = [];

    lines.push(`# 📊 ADO Test Runs Insights & Triage Report`);
    lines.push(
      `**Project:** \`${report.project}\` | **Window:** \`${filter.startDate}\` to \`${filter.endDate}\` | **Generated:** \`${report.generatedAt}\``
    );
    lines.push("");
    lines.push(`## 1. Executive Summary & Execution Split`);
    lines.push(
      `| Metric | Overall | Azure Pipelines (Automated) | Direct in ADO (Manual) |`
    );
    lines.push(`| :--- | :---: | :---: | :---: |`);
    lines.push(
      `| **Test Runs** | **${kpis.totalRuns}** | ${kpis.pipelineRuns} (${kpis.runAutomationSharePct}%) — *Reporter: ${kpis.reporterRuns}, CI: ${kpis.nativePipelineRuns}* | ${kpis.directAdoRuns} (${Number((100 - kpis.runAutomationSharePct).toFixed(1))}%) |`
    );
    lines.push(
      `| **Test Executions** | **${kpis.totalTests}** | ${kpis.pipelineTests} (${kpis.automationSharePct}%) | ${kpis.directAdoTests} (${Number((100 - kpis.automationSharePct).toFixed(1))}%) |`
    );
    lines.push(
      `| **Pass Rate** | **${kpis.overallPassRate}%** (${kpis.passRateDeltaPct >= 0 ? "+" : ""}${kpis.passRateDeltaPct}% vs prev) | ${kpis.pipelinePassRate}% | ${kpis.directAdoPassRate}% |`
    );
    lines.push(
      `| **Failed Executions** | **${sourceComparison.pipeline.failed + sourceComparison.directAdo.failed}** | ${sourceComparison.pipeline.failed} | ${sourceComparison.directAdo.failed} |`
    );
    lines.push(
      `| **P95 Test Duration** | **${(kpis.p95TestDurationMs / 1000).toFixed(2)}s** | ${(sourceComparison.pipeline.p95TestDurationMs / 1000).toFixed(2)}s | ${(sourceComparison.directAdo.p95TestDurationMs / 1000).toFixed(2)}s |`
    );
    lines.push("");

    lines.push(`## 2. Actionable Triage Signals`);
    lines.push(
      `- 🚨 **Active Regressions (Failing on Latest Run):** ${kpis.newRegressionCount}`
    );
    lines.push(`- 🔁 **Flaky Tests Detected in Window:** ${kpis.flakyTestCount}`);
    lines.push(
      `- 🐛 **Open Linked ADO Defects:** ${kpis.openLinkedDefectsCount} (Defect Coverage: **${kpis.defectCoveragePct}%**)`
    );
    lines.push("");

    if (triage.newRegressions.length > 0) {
      lines.push(`### 🚨 Active Regressions & Latest Failures`);
      lines.push(
        `| Test Case | Source | Consecutive Fails | Linked Defect | Error Snippet |`
      );
      lines.push(`| :--- | :---: | :---: | :---: | :--- |`);
      for (const reg of triage.newRegressions.slice(0, 10)) {
        const tcLabel =
          reg.testCaseId !== "Unlinked"
            ? `[TC${reg.testCaseId}](${reg.testCaseUrl || "#"}) ${reg.testCaseTitle}`
            : reg.testCaseTitle;
        const srcBadge =
          reg.executionSource === "pipeline" ? "Pipeline" : "Direct ADO";
        const defectBadge = reg.linkedDefect
          ? `[#${reg.linkedDefect.workItemId} (${reg.linkedDefect.state})](${reg.linkedDefect.url})`
          : "⚠️ Unlinked";
        const snippet = (reg.errorMessage || "N/A")
          .replace(/\r?\n/g, " ")
          .slice(0, 90);
        lines.push(
          `| ${tcLabel} | ${srcBadge} | ${reg.consecutiveFailures} | ${defectBadge} | \`${snippet}\` |`
        );
      }
      lines.push("");
    }

    if (triage.flakyTests.length > 0) {
      lines.push(`### 🔁 Top Flaky Tests (Pass/Fail Oscillation)`);
      lines.push(
        `| Test Case | Flip Count | Flip Rate | Pass / Fail | Linked Defect |`
      );
      lines.push(`| :--- | :---: | :---: | :---: | :---: |`);
      for (const flk of triage.flakyTests.slice(0, 10)) {
        const tcLabel = flk.testCaseId
          ? `[TC${flk.testCaseId}](${flk.testCaseUrl || "#"}) ${flk.testCaseTitle}`
          : flk.testCaseTitle;
        const defectBadge = flk.linkedDefect
          ? `[#${flk.linkedDefect.workItemId}](${flk.linkedDefect.url})`
          : "None";
        lines.push(
          `| ${tcLabel} | ${flk.oscillationCount} flips | ${flk.flipRatePct}% | ${flk.passCount}P / ${flk.failCount}F | ${defectBadge} |`
        );
      }
      lines.push("");
    }

    if (report.quarantine) {
      const q = report.quarantine;
      lines.push(`## 3. Stability, Reliability & Quarantine`);
      lines.push(`- 🛡️ **Active Quarantined Tests:** ${q.totalQuarantined}`);
      lines.push(`- 🎓 **Graduation Candidates (Streak Met):** ${q.graduationCandidatesCount}`);
      lines.push(
        `- ⏱️ **Mean Time to Recovery (MTTR):** ${q.overallMttrHours} hrs (${q.overallMttrRuns} runs)`
      );
      lines.push(
        `- 🔁 **Mean Time Between Failures (MTBF):** ${q.overallMtbfHours} hrs (${q.overallMtbfRuns} runs)`
      );
      lines.push("");

      if (q.activeQuarantined.length > 0) {
        lines.push(`### 🛡️ Active Quarantined Tests`);
        lines.push(`| Test Case | Quarantined By | Streak | Threshold | Reason |`);
        lines.push(`| :--- | :---: | :---: | :---: | :--- |`);
        for (const aq of q.activeQuarantined) {
          const idStr = aq.testCaseId ? `TC${aq.testCaseId}` : aq.testKey;
          lines.push(
            `| [${idStr}] ${aq.testCaseTitle} | ${aq.quarantinedBy || "N/A"} | ${aq.consecutivePasses} passes | ${aq.healingThreshold} | ${aq.reason} |`
          );
        }
        lines.push("");
      }

      if (q.graduationCandidates.length > 0) {
        lines.push(`### 🎓 Graduation Candidates (Ready to Unquarantine)`);
        lines.push(`| Test Case | Streak / Threshold | Quarantined Date | Status |`);
        lines.push(`| :--- | :---: | :---: | :---: |`);
        for (const gc of q.graduationCandidates) {
          const idStr = gc.test.testCaseId ? `TC${gc.test.testCaseId}` : gc.test.testKey;
          lines.push(
            `| [${idStr}] ${gc.test.testCaseTitle} | ${gc.consecutivePasses}/${gc.healingThreshold} | ${gc.test.quarantinedAt.slice(0, 10)} | 🟢 Ready for Graduation |`
          );
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }
}
