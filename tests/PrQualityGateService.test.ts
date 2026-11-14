import { PrQualityGateService, PR_GATE_COMMENT_MARKER } from "../src/PrQualityGateService";
import { ILogger } from "../src/interfaces/ILogger";
import { IQuarantineService } from "../src/interfaces/IQuarantineService";
import { PrGateContext, TestOutcomeSummary } from "../src/interfaces/IPrQualityGateService";
import { CommentThreadStatus, GitStatusState } from "azure-devops-node-api/interfaces/GitInterfaces";

class MockLogger implements ILogger {
    logs: string[] = [];
    warnings: string[] = [];
    errors: string[] = [];
    log(msg: string) { this.logs.push(msg); }
    warn(msg: string) { this.warnings.push(msg); }
    error(msg: string) { this.errors.push(msg); }
}

describe("PrQualityGateService", () => {
    let logger: MockLogger;
    let mockTestApi: any;
    let mockGitApi: any;
    let mockQuarantineService: jest.Mocked<IQuarantineService>;

    const baseContext: PrGateContext = {
        project: "MyProject",
        repositoryId: "repo-123",
        pullRequestId: 42,
        targetBranch: "refs/heads/main",
        sourceBranch: "refs/heads/feature/pr-gate",
        buildId: 900,
        buildNumber: "20261114.1",
        runId: 777,
        runUrl: "https://dev.azure.com/org/MyProject/_testManagement/runs?runId=777",
        publishStatusCheck: true,
        failOnNewRegressions: true,
    };

    beforeEach(() => {
        logger = new MockLogger();
        mockTestApi = {
            queryTestRuns: jest.fn(),
            getTestResults: jest.fn(),
        };
        mockGitApi = {
            getThreads: jest.fn().mockResolvedValue([]),
            createThread: jest.fn().mockResolvedValue({ id: 501 }),
            updateComment: jest.fn().mockResolvedValue({ id: 1 }),
            updateThread: jest.fn().mockResolvedValue({ id: 501 }),
            createPullRequestStatus: jest.fn().mockResolvedValue({ id: 1 }),
        };
        mockQuarantineService = {
            isQuarantined: jest.fn().mockReturnValue(false),
            quarantineTest: jest.fn(),
            unquarantineTest: jest.fn(),
            recordExecutionOutcome: jest.fn(),
            checkExpirations: jest.fn().mockReturnValue([]),
            listAll: jest.fn().mockReturnValue([]),
            getEntry: jest.fn(),
        } as unknown as jest.Mocked<IQuarantineService>;
    });

    it("classifies new regressions, known baseline failures, and quarantined failures accurately", async () => {
        mockTestApi.queryTestRuns.mockResolvedValue([
            { id: 100, name: "Main Nightly", completedDate: new Date("2026-11-13T10:00:00Z") },
            { id: 105, name: "Main Latest", completedDate: new Date("2026-11-14T01:00:00Z") },
        ]);
        mockTestApi.getTestResults.mockResolvedValue([
            { testCase: { id: "2001" }, automatedTestName: "Checkout_Known_TC2001" },
            { automatedTestName: "Legacy_ByName_Failure" },
        ]);

        mockQuarantineService.isQuarantined.mockImplementation(
            (id?: string | number) => String(id) === "3001"
        );

        const results: TestOutcomeSummary[] = [
            { testName: "Login_Pass_TC1000", testCaseId: "1000", outcome: "Passed", durationMs: 40 },
            { testName: "Checkout_Known_TC2001", testCaseId: "2001", outcome: "Failed", durationMs: 120, errorMessage: "Known timeout" },
            { testName: "legacy_byname_failure", outcome: "Failed", durationMs: 80, errorMessage: "Known flake" },
            { testName: "Quarantined_TC3001", testCaseId: "3001", outcome: "Failed", durationMs: 55, errorMessage: "Flaky" },
            { testName: "New_Broken_TC4001", testCaseId: "4001", outcome: "Failed", durationMs: 210, errorMessage: "AssertionError: expected 200 got 500" },
        ];

        const service = new PrQualityGateService(mockTestApi, mockGitApi, logger, mockQuarantineService);
        const evaluation = await service.evaluateAndReport(results, baseContext);

        expect(evaluation.passed).toBe(false);
        expect(evaluation.baselineRunId).toBe(105);
        expect(evaluation.passedCount).toBe(1);
        expect(evaluation.newRegressions).toHaveLength(1);
        expect(evaluation.newRegressions[0].testCaseId).toBe("4001");
        expect(evaluation.knownBaselineFailures).toHaveLength(2);
        expect(evaluation.quarantinedFailures).toHaveLength(1);
        expect(evaluation.commentThreadId).toBe(501);
        expect(evaluation.statusPublished).toBe(true);

        expect(mockGitApi.createThread).toHaveBeenCalledWith(
            expect.objectContaining({
                status: CommentThreadStatus.Active,
                comments: expect.arrayContaining([
                    expect.objectContaining({
                        content: expect.stringContaining(PR_GATE_COMMENT_MARKER),
                    }),
                ]),
            }),
            "repo-123",
            42,
            "MyProject"
        );

        expect(mockGitApi.createPullRequestStatus).toHaveBeenCalledWith(
            expect.objectContaining({
                state: GitStatusState.Failed,
                description: expect.stringContaining("1 new test regression"),
            }),
            "repo-123",
            42,
            "MyProject"
        );
    });

    it("passes the gate when only known baseline and quarantined failures exist", async () => {
        mockTestApi.queryTestRuns.mockResolvedValue([
            { id: 200, name: "Main", completedDate: new Date("2026-11-14T02:00:00Z") },
        ]);
        mockTestApi.getTestResults.mockResolvedValue([
            { testCase: { id: "2001" }, automatedTestName: "Known_TC2001" },
        ]);

        const results: TestOutcomeSummary[] = [
            { testName: "Pass_TC1000", testCaseId: "1000", outcome: "Passed", durationMs: 30 },
            { testName: "Known_TC2001", testCaseId: "2001", outcome: "Failed", durationMs: 90 },
            { testName: "Quarantined_TC3001", testCaseId: "3001", outcome: "Failed", durationMs: 50, isQuarantined: true },
        ];

        const service = new PrQualityGateService(mockTestApi, mockGitApi, logger, mockQuarantineService);
        const evaluation = await service.evaluateAndReport(results, baseContext);

        expect(evaluation.passed).toBe(true);
        expect(evaluation.newRegressions).toHaveLength(0);
        expect(mockGitApi.createPullRequestStatus).toHaveBeenCalledWith(
            expect.objectContaining({
                state: GitStatusState.Succeeded,
            }),
            "repo-123",
            42,
            "MyProject"
        );
    });

    it("updates existing PR comment thread idempotently instead of creating duplicates", async () => {
        mockTestApi.queryTestRuns.mockResolvedValue([]);
        mockGitApi.getThreads.mockResolvedValue([
            {
                id: 888,
                isDeleted: false,
                comments: [
                    { id: 12, isDeleted: false, content: `${PR_GATE_COMMENT_MARKER}\nOld content` },
                ],
            },
        ]);

        const results: TestOutcomeSummary[] = [
            { testName: "Pass_TC1000", testCaseId: "1000", outcome: "Passed", durationMs: 25 },
        ];

        const service = new PrQualityGateService(mockTestApi, mockGitApi, logger);
        const evaluation = await service.evaluateAndReport(results, baseContext);

        expect(evaluation.passed).toBe(true);
        expect(evaluation.commentThreadId).toBe(888);
        expect(mockGitApi.createThread).not.toHaveBeenCalled();
        expect(mockGitApi.updateComment).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("✅ PASSED") }),
            "repo-123",
            42,
            888,
            12,
            "MyProject"
        );
        expect(mockGitApi.updateThread).toHaveBeenCalledWith(
            { status: CommentThreadStatus.Fixed },
            "repo-123",
            42,
            888,
            "MyProject"
        );
    });

    it("handles missing baseline runs and PR status API permission errors gracefully", async () => {
        mockTestApi.queryTestRuns.mockResolvedValue([]);
        mockGitApi.createPullRequestStatus.mockRejectedValue(new Error("TF401027: Access denied"));

        const results: TestOutcomeSummary[] = [
            { testName: "New_Fail_TC999", testCaseId: "999", outcome: "Failed", durationMs: 100 },
        ];

        const service = new PrQualityGateService(mockTestApi, mockGitApi, logger);
        const evaluation = await service.evaluateAndReport(results, baseContext);

        expect(evaluation.passed).toBe(false);
        expect(evaluation.baselineRunId).toBeUndefined();
        expect(evaluation.newRegressions).toHaveLength(1);
        expect(evaluation.statusPublished).toBe(false);
        expect(logger.warnings.some((w) => w.includes("Failed to publish PR Status Check"))).toBe(true);
    });
});
