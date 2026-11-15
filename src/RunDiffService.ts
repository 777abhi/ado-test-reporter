import {
  DashboardRunRecord,
  DashboardTestResultRecord,
  LinkedDefectRecord,
} from "./interfaces/IDashboardService";
import { QuarantinedTestRecord } from "./interfaces/IQuarantineService";

export interface RunDiffTestItem {
  testCaseId?: string;
  testCaseTitle: string;
  automatedTestName?: string;
  errorMessage?: string;
  durationMs: number;
  baselineDurationMs?: number;
  testCaseUrl?: string;
  linkedDefect?: LinkedDefectRecord;
}

export interface RunDiffReport {
  passed: boolean;
  candidateRun: {
    runId: number;
    name: string;
    planName?: string;
    buildNumber?: string;
    completedDate: string;
    passRate: number;
    durationMs: number;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    runUrl: string;
  };
  baselineRun?: {
    runId: number;
    name: string;
    planName?: string;
    buildNumber?: string;
    completedDate: string;
    passRate: number;
    durationMs: number;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    runUrl: string;
  };
  deltas: {
    passRateDeltaPct: number;
    durationDeltaMs: number;
    passedDelta: number;
    failedDelta: number;
  };
  newRegressions: RunDiffTestItem[];
  knownBaselineFailures: RunDiffTestItem[];
  quarantinedFailures: RunDiffTestItem[];
  fixedTests: RunDiffTestItem[];
  summaryMarkdown: string;
}

export class RunDiffService {
  static normalizeTestName(name: string): string {
    return (name || "")
      .trim()
      .toLowerCase()
      .replace(/^tc\d+[_\s:-]*/i, "")
      .replace(/[_\s-]+/g, " ");
  }

  static selectDefaultRuns(runs: DashboardRunRecord[]): {
    candidateRun?: DashboardRunRecord;
    baselineRun?: DashboardRunRecord;
  } {
    if (!runs || runs.length === 0) {
      return {};
    }

    const sorted = [...runs].sort(
      (a, b) =>
        new Date(b.completedDate || b.startedDate).getTime() -
        new Date(a.completedDate || a.startedDate).getTime()
    );

    const candidateRun = sorted[0];
    if (sorted.length === 1) {
      return { candidateRun };
    }

    const remaining = sorted.slice(1);
    const samePlan = candidateRun.planName
      ? remaining.find((r) => r.planName === candidateRun.planName)
      : undefined;

    return {
      candidateRun,
      baselineRun: samePlan || remaining[0],
    };
  }

  static isTestQuarantined(
    result: DashboardTestResultRecord,
    quarantinedRecords: QuarantinedTestRecord[] = []
  ): boolean {
    if (!quarantinedRecords || quarantinedRecords.length === 0) {
      return false;
    }

    const active = quarantinedRecords.filter((q) => q.status === "active");
    const resultId = result.testCaseId ? String(result.testCaseId).trim() : "";
    const normTitle = this.normalizeTestName(result.testCaseTitle);
    const normAuto = result.automatedTestName
      ? this.normalizeTestName(result.automatedTestName)
      : "";

    return active.some((q) => {
      if (resultId && q.testCaseId && String(q.testCaseId).trim() === resultId) {
        return true;
      }
      const qTitle = this.normalizeTestName(q.testCaseTitle);
      if (qTitle && (qTitle === normTitle || (normAuto && qTitle === normAuto))) {
        return true;
      }
      if (
        q.testKey &&
        resultId &&
        q.testKey.toLowerCase() === `tc:${resultId.toLowerCase()}`
      ) {
        return true;
      }
      return false;
    });
  }

  static diffRuns(
    candidateRun: DashboardRunRecord,
    baselineRun?: DashboardRunRecord,
    quarantinedRecords: QuarantinedTestRecord[] = []
  ): RunDiffReport {
    const baselineFailedIds = new Set<string>();
    const baselineFailedNames = new Set<string>();
    const baselineFailedMap = new Map<string, DashboardTestResultRecord>();

    if (baselineRun) {
      for (const res of baselineRun.results || []) {
        if (res.outcome === "Failed") {
          if (res.testCaseId) {
            const idKey = String(res.testCaseId).trim();
            baselineFailedIds.add(idKey);
            baselineFailedMap.set(`id:${idKey}`, res);
          }
          const normTitle = this.normalizeTestName(res.testCaseTitle);
          if (normTitle) {
            baselineFailedNames.add(normTitle);
            baselineFailedMap.set(`name:${normTitle}`, res);
          }
          if (res.automatedTestName) {
            const normAuto = this.normalizeTestName(res.automatedTestName);
            if (normAuto) {
              baselineFailedNames.add(normAuto);
              baselineFailedMap.set(`name:${normAuto}`, res);
            }
          }
        }
      }
    }

    const newRegressions: RunDiffTestItem[] = [];
    const knownBaselineFailures: RunDiffTestItem[] = [];
    const quarantinedFailures: RunDiffTestItem[] = [];
    const fixedTests: RunDiffTestItem[] = [];

    for (const res of candidateRun.results || []) {
      const idKey = res.testCaseId ? String(res.testCaseId).trim() : "";
      const normTitle = this.normalizeTestName(res.testCaseTitle);
      const normAuto = res.automatedTestName
        ? this.normalizeTestName(res.automatedTestName)
        : "";

      const matchedBaseline =
        (idKey ? baselineFailedMap.get(`id:${idKey}`) : undefined) ||
        (normTitle ? baselineFailedMap.get(`name:${normTitle}`) : undefined) ||
        (normAuto ? baselineFailedMap.get(`name:${normAuto}`) : undefined);

      const inBaselineFailed =
        (idKey && baselineFailedIds.has(idKey)) ||
        (normTitle && baselineFailedNames.has(normTitle)) ||
        (normAuto && baselineFailedNames.has(normAuto));

      if (res.outcome === "Passed" && inBaselineFailed) {
        fixedTests.push({
          testCaseId: res.testCaseId,
          testCaseTitle: res.testCaseTitle,
          automatedTestName: res.automatedTestName,
          durationMs: res.durationMs,
          baselineDurationMs: matchedBaseline?.durationMs,
          testCaseUrl: res.testCaseUrl,
          linkedDefect: res.linkedDefect || matchedBaseline?.linkedDefect,
        });
        continue;
      }

      if (res.outcome !== "Failed") {
        continue;
      }

      const item: RunDiffTestItem = {
        testCaseId: res.testCaseId,
        testCaseTitle: res.testCaseTitle,
        automatedTestName: res.automatedTestName,
        errorMessage: res.errorMessage,
        durationMs: res.durationMs,
        baselineDurationMs: matchedBaseline?.durationMs,
        testCaseUrl: res.testCaseUrl,
        linkedDefect: res.linkedDefect,
      };

      if (this.isTestQuarantined(res, quarantinedRecords)) {
        quarantinedFailures.push(item);
      } else if (inBaselineFailed) {
        knownBaselineFailures.push(item);
      } else {
        newRegressions.push(item);
      }
    }

    const passed = newRegressions.length === 0;
    const passRateDeltaPct = baselineRun
      ? Number((candidateRun.passRate - baselineRun.passRate).toFixed(1))
      : 0;
    const durationDeltaMs = baselineRun
      ? candidateRun.durationMs - baselineRun.durationMs
      : 0;
    const passedDelta = baselineRun
      ? candidateRun.passedTests - baselineRun.passedTests
      : 0;
    const failedDelta = baselineRun
      ? candidateRun.failedTests - baselineRun.failedTests
      : 0;

    const report: RunDiffReport = {
      passed,
      candidateRun: {
        runId: candidateRun.runId,
        name: candidateRun.name,
        planName: candidateRun.planName,
        buildNumber: candidateRun.buildNumber,
        completedDate: candidateRun.completedDate,
        passRate: candidateRun.passRate,
        durationMs: candidateRun.durationMs,
        totalTests: candidateRun.totalTests,
        passedTests: candidateRun.passedTests,
        failedTests: candidateRun.failedTests,
        runUrl: candidateRun.runUrl,
      },
      baselineRun: baselineRun
        ? {
            runId: baselineRun.runId,
            name: baselineRun.name,
            planName: baselineRun.planName,
            buildNumber: baselineRun.buildNumber,
            completedDate: baselineRun.completedDate,
            passRate: baselineRun.passRate,
            durationMs: baselineRun.durationMs,
            totalTests: baselineRun.totalTests,
            passedTests: baselineRun.passedTests,
            failedTests: baselineRun.failedTests,
            runUrl: baselineRun.runUrl,
          }
        : undefined,
      deltas: {
        passRateDeltaPct,
        durationDeltaMs,
        passedDelta,
        failedDelta,
      },
      newRegressions,
      knownBaselineFailures,
      quarantinedFailures,
      fixedTests,
      summaryMarkdown: "",
    };

    report.summaryMarkdown = this.buildSummaryMarkdown(report);
    return report;
  }

  static buildSummaryMarkdown(report: RunDiffReport): string {
    const statusBadge = report.passed
      ? "✅ **PASSED** — No new test regressions introduced"
      : `❌ **FAILED** — ${report.newRegressions.length} new test regression(s) detected`;

    const baselineInfo = report.baselineRun
      ? `Run #${report.baselineRun.runId} (\`${report.baselineRun.name}\`)`
      : "_None (no baseline run selected)_";

    const lines: string[] = [
      `## 🚦 ADO Test Reporter — PR Quality Gate`,
      "",
      `**Gate Verdict:** ${statusBadge}`,
      `**Candidate Run:** Run #${report.candidateRun.runId} (\`${report.candidateRun.name}\`) — **${report.candidateRun.passRate}%** pass rate`,
      `**Baseline Run:** ${baselineInfo}`,
      "",
      "| Metric | Count |",
      "| :--- | :---: |",
      `| Total Tests | ${report.candidateRun.totalTests} |`,
      `| Passed | ${report.candidateRun.passedTests} |`,
      `| 🚨 New Regressions (Blocking) | **${report.newRegressions.length}** |`,
      `| ✅ Fixed / Recovered | ${report.fixedTests.length} |`,
      `| 📌 Known Baseline Failures (Non-blocking) | ${report.knownBaselineFailures.length} |`,
      `| 🛡️ Quarantined Failures (Suppressed) | ${report.quarantinedFailures.length} |`,
      "",
    ];

    if (report.newRegressions.length > 0) {
      lines.push("### 🚨 New Regressions (Must Fix)");
      for (const f of report.newRegressions.slice(0, 20)) {
        const tc = f.testCaseId ? ` \`[TC${f.testCaseId}]\`` : "";
        const err = f.errorMessage
          ? ` — \`${f.errorMessage.replace(/[\r\n]+/g, " ").slice(0, 140)}\``
          : "";
        lines.push(`- **${f.testCaseTitle}**${tc}${err}`);
      }
      if (report.newRegressions.length > 20) {
        lines.push(`- _...and ${report.newRegressions.length - 20} more._`);
      }
      lines.push("");
    }

    if (report.fixedTests.length > 0) {
      lines.push("### ✅ Fixed / Recovered Tests");
      for (const f of report.fixedTests.slice(0, 15)) {
        const tc = f.testCaseId ? ` \`[TC${f.testCaseId}]\`` : "";
        lines.push(`- **${f.testCaseTitle}**${tc}`);
      }
      lines.push("");
    }

    if (report.knownBaselineFailures.length > 0) {
      lines.push("### 📌 Known Baseline Failures (Pre-existing)");
      for (const f of report.knownBaselineFailures.slice(0, 15)) {
        const tc = f.testCaseId ? ` \`[TC${f.testCaseId}]\`` : "";
        lines.push(`- ${f.testCaseTitle}${tc}`);
      }
      lines.push("");
    }

    if (report.quarantinedFailures.length > 0) {
      lines.push("### 🛡️ Quarantined Failures (Suppressed)");
      for (const f of report.quarantinedFailures.slice(0, 15)) {
        const tc = f.testCaseId ? ` \`[TC${f.testCaseId}]\`` : "";
        lines.push(`- ${f.testCaseTitle}${tc}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}
