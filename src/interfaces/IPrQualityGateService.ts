export interface PrGateContext {
    project: string;
    repositoryId: string;
    pullRequestId: number;
    targetBranch: string;
    sourceBranch?: string;
    commitSha?: string;
    buildId?: number;
    buildNumber?: string;
    buildUri?: string;
    runId?: number;
    runUrl?: string;
    publishStatusCheck?: boolean;
    failOnNewRegressions?: boolean;
}

export interface TestOutcomeSummary {
    testName: string;
    testCaseId?: string;
    outcome: "Passed" | "Failed" | "Skipped" | string;
    durationMs: number;
    errorMessage?: string;
    isQuarantined?: boolean;
}

export type FailureClassification = "NEW_REGRESSION" | "KNOWN_BASELINE" | "QUARANTINED";

export interface ClassifiedFailure {
    testName: string;
    testCaseId?: string;
    errorMessage?: string;
    classification: FailureClassification;
}

export interface PrGateEvaluationResult {
    passed: boolean;
    baselineRunId?: number;
    baselineRunName?: string;
    totalTests: number;
    passedCount: number;
    newRegressions: ClassifiedFailure[];
    knownBaselineFailures: ClassifiedFailure[];
    quarantinedFailures: ClassifiedFailure[];
    summaryMarkdown: string;
    commentThreadId?: number;
    statusPublished?: boolean;
}

export interface IPrQualityGateService {
    evaluateAndReport(
        results: TestOutcomeSummary[],
        context: PrGateContext
    ): Promise<PrGateEvaluationResult>;
}
