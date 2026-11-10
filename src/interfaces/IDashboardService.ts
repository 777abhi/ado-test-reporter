import { GraduationCandidate, QuarantinedTestRecord } from "./IQuarantineService";

export type ExecutionSource = "pipeline" | "direct_ado";

export type ExecutionSubSource =
  | "ado_test_reporter"
  | "azure_pipeline"
  | "direct_manual";

export type NormalizedOutcome =
  | "Passed"
  | "Failed"
  | "Blocked"
  | "NotExecuted"
  | "Other";

export interface LinkedDefectRecord {
  workItemId: number;
  workItemType: string;
  title: string;
  state: string;
  url: string;
  isFlakyTagged?: boolean;
}

export interface DashboardTestResultRecord {
  resultId: number;
  runId: number;
  testCaseId?: string;
  testCaseTitle: string;
  automatedTestName?: string;
  outcome: NormalizedOutcome;
  durationMs: number;
  errorMessage?: string;
  errorHash?: string;
  completedDate: string;
  executionSource: ExecutionSource;
  executionSubSource: ExecutionSubSource;
  testCaseUrl?: string;
  linkedDefect?: LinkedDefectRecord;
}

export interface DashboardRunRecord {
  runId: number;
  name: string;
  state: string;
  startedDate: string;
  completedDate: string;
  durationMs: number;
  isAutomated: boolean;
  executionSource: ExecutionSource;
  executionSubSource: ExecutionSubSource;
  planId?: number;
  planName?: string;
  suiteId?: number;
  suiteName?: string;
  buildId?: number;
  buildNumber?: string;
  releaseId?: number;
  ownerName?: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  blockedTests: number;
  notExecutedTests: number;
  otherTests: number;
  passRate: number;
  runUrl: string;
  buildUrl?: string;
  planUrl?: string;
  results: DashboardTestResultRecord[];
}

export interface DashboardCacheData {
  version: number;
  orgUrl: string;
  project: string;
  lastSyncedAt?: string;
  isDemoData?: boolean;
  runs: DashboardRunRecord[];
}

export interface DashboardFilterOptions {
  startDate?: string;
  endDate?: string;
  planName?: string;
  buildNumber?: string;
  executionSource?: "all" | ExecutionSource;
  executionSubSource?: "all" | ExecutionSubSource;
}

export interface SourceBreakdownStats {
  runs: number;
  tests: number;
  passed: number;
  failed: number;
  blocked: number;
  notExecuted: number;
  other: number;
  passRate: number;
  avgRunDurationMs: number;
  p95RunDurationMs: number;
  avgTestDurationMs: number;
  p95TestDurationMs: number;
}

export interface TrendBucket {
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
  overallPassRate: number;
  pipelinePassRate: number;
  directAdoPassRate: number;
  avgRunDurationMs: number;
}

export interface PlanSuiteHealthEntry {
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
  passRate: number;
  flakyCount: number;
}

export interface RegressionInsight {
  testCaseId: string;
  testCaseTitle: string;
  latestRunId: number;
  latestRunName: string;
  latestCompletedDate: string;
  previousPassedCount: number;
  consecutiveFailures: number;
  failingSinceDate: string;
  errorMessage?: string;
  executionSource: ExecutionSource;
  executionSubSource: ExecutionSubSource;
  testCaseUrl?: string;
  runUrl: string;
  linkedDefect?: LinkedDefectRecord;
}

export interface RecurringFailureGroup {
  errorHash: string;
  errorSnippet: string;
  occurrences: number;
  affectedTestCaseIds: string[];
  affectedTestTitles: string[];
  pipelineOccurrences: number;
  directAdoOccurrences: number;
  latestRunId: number;
  latestFailureDate: string;
  sampleRunUrl: string;
  linkedDefect?: LinkedDefectRecord;
}

export interface FlakyTestInsight {
  testKey: string;
  testCaseId?: string;
  testCaseTitle: string;
  totalExecutions: number;
  passCount: number;
  failCount: number;
  oscillationCount: number;
  flipRatePct: number;
  pipelineExecutions: number;
  directAdoExecutions: number;
  latestOutcome: NormalizedOutcome;
  outcomeSequence: NormalizedOutcome[];
  testCaseUrl?: string;
  linkedDefect?: LinkedDefectRecord;
}

export interface SlowTestInsight {
  testKey: string;
  testCaseId?: string;
  testCaseTitle: string;
  executions: number;
  maxDurationMs: number;
  p95DurationMs: number;
  avgDurationMs: number;
  executionSource: ExecutionSource;
  executionSubSource: ExecutionSubSource;
  latestRunId: number;
  runUrl: string;
  testCaseUrl?: string;
}

export interface TestReliabilityMetric {
  testKey: string;
  testCaseId?: string;
  testCaseTitle: string;
  totalExecutions: number;
  failCount: number;
  passCount: number;
  recoveryCount: number;
  mttrHours: number;
  mttrRuns: number;
  mtbfHours: number;
  mtbfRuns: number;
  stabilityScorePct: number;
  isQuarantined: boolean;
  quarantineRecord?: QuarantinedTestRecord;
  isReadyForGraduation?: boolean;
}

export interface QuarantineDashboardSection {
  totalQuarantined: number;
  graduationCandidatesCount: number;
  overallMttrHours: number;
  overallMttrRuns: number;
  overallMtbfHours: number;
  overallMtbfRuns: number;
  activeQuarantined: QuarantinedTestRecord[];
  graduationCandidates: GraduationCandidate[];
  reliabilityLeaderboard: TestReliabilityMetric[];
}

export interface DashboardKpis {
  totalRuns: number;
  pipelineRuns: number;
  directAdoRuns: number;
  reporterRuns: number;
  nativePipelineRuns: number;
  totalTests: number;
  pipelineTests: number;
  directAdoTests: number;
  automationSharePct: number;
  runAutomationSharePct: number;
  overallPassRate: number;
  pipelinePassRate: number;
  directAdoPassRate: number;
  passRateDeltaPct: number;
  flakyTestCount: number;
  newRegressionCount: number;
  recurringFailureGroupCount: number;
  openLinkedDefectsCount: number;
  defectCoveragePct: number;
  avgRunDurationMs: number;
  p95RunDurationMs: number;
  avgTestDurationMs: number;
  p95TestDurationMs: number;
  quarantinedTestCount: number;
  graduationCandidatesCount: number;
  overallMttrHours: number;
  overallMttrRuns: number;
  overallMtbfHours: number;
  overallMtbfRuns: number;
}

export interface DashboardInsightsReport {
  generatedAt: string;
  orgUrl: string;
  project: string;
  filter: Required<DashboardFilterOptions>;
  cacheInfo: {
    lastSyncedAt?: string;
    totalCachedRuns: number;
    isDemoData: boolean;
    cacheFilePath: string;
  };
  kpis: DashboardKpis;
  sourceComparison: {
    pipeline: SourceBreakdownStats;
    directAdo: SourceBreakdownStats;
    subSources: {
      adoTestReporter: SourceBreakdownStats;
      azurePipeline: SourceBreakdownStats;
      directManual: SourceBreakdownStats;
    };
  };
  trends: {
    bucketUnit: "day" | "week";
    buckets: TrendBucket[];
  };
  planSuiteHealth: PlanSuiteHealthEntry[];
  triage: {
    newRegressions: RegressionInsight[];
    recurringFailures: RecurringFailureGroup[];
    flakyTests: FlakyTestInsight[];
    slowestTests: SlowTestInsight[];
  };
  quarantine?: QuarantineDashboardSection;
  availableFilters: {
    plans: string[];
    builds: string[];
  };
  runs: DashboardRunRecord[];
}

export interface IDashboardCacheRepository {
  getCacheFilePath(): string;
  load(): DashboardCacheData;
  save(data: DashboardCacheData): void;
  upsertRuns(
    runs: DashboardRunRecord[],
    orgUrl: string,
    project: string,
    isDemoData?: boolean
  ): DashboardCacheData;
}

export interface IDashboardService {
  syncFromAdo(startDate: Date, endDate: Date): Promise<DashboardCacheData>;
  seedDemoDataIfEmpty(): DashboardCacheData;
  buildReport(filter?: DashboardFilterOptions): DashboardInsightsReport;
  exportToCsv(report: DashboardInsightsReport): string;
  exportToMarkdown(report: DashboardInsightsReport): string;
}
