import { ITestApi } from "azure-devops-node-api/TestApi";
import { IGitApi } from "azure-devops-node-api/GitApi";
import { TestCaseResult, TestOutcome, TestRun, TestRunState } from "azure-devops-node-api/interfaces/TestInterfaces";
import {
    CommentThreadStatus,
    CommentType,
    GitPullRequestCommentThread,
    GitPullRequestStatus,
    GitStatusState,
} from "azure-devops-node-api/interfaces/GitInterfaces";
import { ILogger } from "./interfaces/ILogger";
import { IQuarantineService } from "./interfaces/IQuarantineService";
import {
    ClassifiedFailure,
    IPrQualityGateService,
    PrGateContext,
    PrGateEvaluationResult,
    TestOutcomeSummary,
} from "./interfaces/IPrQualityGateService";
import { fetchAllSkipTop } from "./utils/AsyncUtils";

export const PR_GATE_COMMENT_MARKER = "<!-- ado-test-reporter-pr-gate -->";

interface BaselineLookupResult {
    runId?: number;
    runName?: string;
    failedTestCaseIds: Set<string>;
    failedTestNames: Set<string>;
}

export class PrQualityGateService implements IPrQualityGateService {
    constructor(
        private testApi: ITestApi,
        private gitApi: IGitApi | undefined,
        private logger: ILogger,
        private quarantineService?: IQuarantineService
    ) {}

    async evaluateAndReport(
        results: TestOutcomeSummary[],
        context: PrGateContext
    ): Promise<PrGateEvaluationResult> {
        const baseline = await this.fetchBaselineFailures(context.project, context.targetBranch);

        const newRegressions: ClassifiedFailure[] = [];
        const knownBaselineFailures: ClassifiedFailure[] = [];
        const quarantinedFailures: ClassifiedFailure[] = [];
        let passedCount = 0;

        for (const item of results) {
            if (item.outcome === "Passed") {
                passedCount++;
                continue;
            }
            if (item.outcome !== "Failed") {
                continue;
            }

            const isQuarantined =
                item.isQuarantined === true ||
                (this.quarantineService?.isQuarantined(item.testCaseId, item.testName) ?? false);

            if (isQuarantined) {
                quarantinedFailures.push({
                    testName: item.testName,
                    testCaseId: item.testCaseId,
                    errorMessage: item.errorMessage,
                    classification: "QUARANTINED",
                });
                continue;
            }

            const normalizedName = this.normalizeName(item.testName);
            const matchedById = !!item.testCaseId && baseline.failedTestCaseIds.has(String(item.testCaseId));
            const matchedByName = baseline.failedTestNames.has(normalizedName);

            if (matchedById || matchedByName) {
                knownBaselineFailures.push({
                    testName: item.testName,
                    testCaseId: item.testCaseId,
                    errorMessage: item.errorMessage,
                    classification: "KNOWN_BASELINE",
                });
            } else {
                newRegressions.push({
                    testName: item.testName,
                    testCaseId: item.testCaseId,
                    errorMessage: item.errorMessage,
                    classification: "NEW_REGRESSION",
                });
            }
        }

        const failOnNewRegressions = context.failOnNewRegressions !== false;
        const passed = failOnNewRegressions ? newRegressions.length === 0 : true;

        const evaluation: PrGateEvaluationResult = {
            passed,
            baselineRunId: baseline.runId,
            baselineRunName: baseline.runName,
            totalTests: results.length,
            passedCount,
            newRegressions,
            knownBaselineFailures,
            quarantinedFailures,
            summaryMarkdown: "",
        };

        evaluation.summaryMarkdown = this.buildSummaryMarkdown(evaluation, context);

        if (this.gitApi && context.pullRequestId > 0 && context.repositoryId) {
            evaluation.commentThreadId = await this.upsertPrComment(
                context,
                evaluation.summaryMarkdown,
                passed
            );

            if (context.publishStatusCheck) {
                evaluation.statusPublished = await this.publishStatusCheck(
                    context,
                    passed,
                    newRegressions.length
                );
            }
        } else {
            this.logger.warn(
                "⚠️ PR comment/status skipped: missing GitApi, repositoryId, or pullRequestId."
            );
        }

        return evaluation;
    }

    private normalizeName(name: string): string {
        return name.trim().toLowerCase();
    }

    private getBranchCandidates(targetBranch: string): string[] {
        const trimmed = (targetBranch || "").trim();
        if (!trimmed) return [];
        const shortName = trimmed.replace(/^refs\/heads\//i, "");
        const fullRef = `refs/heads/${shortName}`;
        return Array.from(new Set([trimmed, fullRef, shortName]));
    }

    async fetchBaselineFailures(
        project: string,
        targetBranch: string
    ): Promise<BaselineLookupResult> {
        const empty: BaselineLookupResult = {
            failedTestCaseIds: new Set<string>(),
            failedTestNames: new Set<string>(),
        };

        try {
            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - 14 * 86400000);
            const candidates = this.getBranchCandidates(targetBranch);

            let latestRun: TestRun | undefined;
            for (const branchCandidate of candidates) {
                const runs = await this.testApi.queryTestRuns(
                    project,
                    startDate,
                    endDate,
                    TestRunState.Completed,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    branchCandidate,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    10
                );

                if (runs && runs.length > 0) {
                    const sorted = [...runs].sort((a, b) => {
                        const aTime = a.completedDate ? new Date(a.completedDate).getTime() : 0;
                        const bTime = b.completedDate ? new Date(b.completedDate).getTime() : 0;
                        if (bTime !== aTime) return bTime - aTime;
                        return (b.id || 0) - (a.id || 0);
                    });
                    latestRun = sorted[0];
                    break;
                }
            }

            if (!latestRun || !latestRun.id) {
                this.logger.log(
                    `ℹ️ No completed baseline Test Run found on target branch '${targetBranch}' in the last 14 days.`
                );
                return empty;
            }

            this.logger.log(
                `📌 Using baseline Test Run #${latestRun.id} ('${latestRun.name || "Unnamed"}') on '${targetBranch}'.`
            );

            const failedResults: TestCaseResult[] = await fetchAllSkipTop(
                (skip, top) =>
                    this.testApi.getTestResults(
                        project,
                        latestRun.id!,
                        undefined,
                        skip,
                        top,
                        [TestOutcome.Failed]
                    ),
                1000
            );

            const failedTestCaseIds = new Set<string>();
            const failedTestNames = new Set<string>();

            for (const res of failedResults || []) {
                if (res.testCase?.id) {
                    failedTestCaseIds.add(String(res.testCase.id));
                }
                if (res.automatedTestName) {
                    failedTestNames.add(this.normalizeName(res.automatedTestName));
                }
                if (res.testCaseTitle) {
                    failedTestNames.add(this.normalizeName(res.testCaseTitle));
                }
            }

            return {
                runId: latestRun.id,
                runName: latestRun.name,
                failedTestCaseIds,
                failedTestNames,
            };
        } catch (err: any) {
            this.logger.warn(
                `⚠️ Failed to query baseline Test Run on '${targetBranch}': ${err?.message || err}`
            );
            return empty;
        }
    }

    buildSummaryMarkdown(
        evaluation: PrGateEvaluationResult,
        context: PrGateContext
    ): string {
        const badge = evaluation.passed ? "✅ PASSED" : "❌ FAILED";
        const lines: string[] = [
            PR_GATE_COMMENT_MARKER,
            `## 🛡️ ADO Test Reporter — PR Quality Gate: ${badge}`,
            "",
            `| Metric | Value |`,
            `|---|---|`,
            `| **Total Tests** | ${evaluation.totalTests} |`,
            `| **Passed** | ${evaluation.passedCount} |`,
            `| **New Regressions** | ${evaluation.newRegressions.length} |`,
            `| **Known Baseline Failures** | ${evaluation.knownBaselineFailures.length} |`,
            `| **Quarantined (Soft-Pass)** | ${evaluation.quarantinedFailures.length} |`,
            `| **Target Branch** | \`${context.targetBranch}\` |`,
            `| **Baseline Run** | ${
                evaluation.baselineRunId
                    ? `#${evaluation.baselineRunId} (${evaluation.baselineRunName || "Completed"})`
                    : "None found (all non-quarantined failures treated as new)"
            } |`,
        ];

        if (context.runUrl) {
            lines.push(`| **PR Test Run** | [Run #${context.runId || "View"}](${context.runUrl}) |`);
        } else if (context.buildUri) {
            lines.push(`| **Build** | [Build ${context.buildNumber || context.buildId || "View"}](${context.buildUri}) |`);
        }

        if (evaluation.newRegressions.length > 0) {
            lines.push("", "### ❌ New Regressions (Blocking)");
            for (const f of evaluation.newRegressions) {
                const tc = f.testCaseId ? ` [TC ${f.testCaseId}]` : "";
                const err = f.errorMessage ? ` — \`${f.errorMessage.replace(/\r?\n/g, " ").slice(0, 140)}\`` : "";
                lines.push(`- **${f.testName}**${tc}${err}`);
            }
        }

        if (evaluation.knownBaselineFailures.length > 0) {
            lines.push("", "### ⚠️ Known Baseline Failures (Non-Blocking)");
            for (const f of evaluation.knownBaselineFailures) {
                const tc = f.testCaseId ? ` [TC ${f.testCaseId}]` : "";
                lines.push(`- ${f.testName}${tc}`);
            }
        }

        if (evaluation.quarantinedFailures.length > 0) {
            lines.push("", "### 🛡️ Quarantined Failures (Soft-Pass)");
            for (const f of evaluation.quarantinedFailures) {
                const tc = f.testCaseId ? ` [TC ${f.testCaseId}]` : "";
                lines.push(`- ${f.testName}${tc}`);
            }
        }

        return lines.join("\n");
    }

    private async upsertPrComment(
        context: PrGateContext,
        markdown: string,
        passed: boolean
    ): Promise<number | undefined> {
        if (!this.gitApi) return undefined;

        const desiredStatus = passed ? CommentThreadStatus.Fixed : CommentThreadStatus.Active;

        try {
            const threads = await this.gitApi.getThreads(
                context.repositoryId,
                context.pullRequestId,
                context.project
            );

            const existing = (threads || []).find(
                (t) =>
                    !t.isDeleted &&
                    t.comments &&
                    t.comments.some((c) => !c.isDeleted && (c.content || "").includes(PR_GATE_COMMENT_MARKER))
            );

            if (existing && existing.id && existing.comments && existing.comments[0]?.id) {
                const targetComment = existing.comments.find((c) =>
                    (c.content || "").includes(PR_GATE_COMMENT_MARKER)
                )!;

                await this.gitApi.updateComment(
                    { content: markdown },
                    context.repositoryId,
                    context.pullRequestId,
                    existing.id,
                    targetComment.id!,
                    context.project
                );

                await this.gitApi.updateThread(
                    { status: desiredStatus },
                    context.repositoryId,
                    context.pullRequestId,
                    existing.id,
                    context.project
                );

                this.logger.log(`💬 Updated existing PR Quality Gate comment thread #${existing.id}.`);
                return existing.id;
            }

            const newThread: GitPullRequestCommentThread = {
                comments: [
                    {
                        parentCommentId: 0,
                        content: markdown,
                        commentType: CommentType.Text,
                    },
                ],
                status: desiredStatus,
            };

            const created = await this.gitApi.createThread(
                newThread,
                context.repositoryId,
                context.pullRequestId,
                context.project
            );
            this.logger.log(`💬 Created PR Quality Gate comment thread #${created?.id}.`);
            return created?.id;
        } catch (err: any) {
            this.logger.warn(`⚠️ Failed to post/update PR comment: ${err?.message || err}`);
            return undefined;
        }
    }

    private async publishStatusCheck(
        context: PrGateContext,
        passed: boolean,
        newRegressionCount: number
    ): Promise<boolean> {
        if (!this.gitApi) return false;

        try {
            const statusPayload: GitPullRequestStatus = {
                state: passed ? GitStatusState.Succeeded : GitStatusState.Failed,
                description: passed
                    ? "Quality Gate passed: 0 new test regressions"
                    : `Quality Gate failed: ${newRegressionCount} new test regression(s)`,
                context: {
                    name: "quality-gate",
                    genre: "ado-test-reporter",
                },
                targetUrl: context.runUrl || context.buildUri,
            };

            await this.gitApi.createPullRequestStatus(
                statusPayload,
                context.repositoryId,
                context.pullRequestId,
                context.project
            );
            this.logger.log(
                `🚦 Published PR Status Check: ${passed ? "Succeeded" : "Failed"}`
            );
            return true;
        } catch (err: any) {
            this.logger.warn(`⚠️ Failed to publish PR Status Check: ${err?.message || err}`);
            return false;
        }
    }
}
