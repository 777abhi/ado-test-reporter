import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  DashboardCacheData,
  DashboardRunRecord,
  DashboardTestResultRecord,
  IDashboardCacheRepository,
  LinkedDefectRecord,
  NormalizedOutcome,
} from "./interfaces/IDashboardService";
import { ILogger } from "./interfaces/ILogger";
import { isSafePath } from "./utils/PathUtils";
import { SecretRedactor } from "./utils/SecretRedactor";

export class DashboardCacheRepository implements IDashboardCacheRepository {
  private readonly cacheFilePath: string;
  private readonly rootDir: string;

  constructor(
    private logger: ILogger,
    cacheFilePath?: string,
    rootDir: string = process.cwd()
  ) {
    this.rootDir = path.resolve(rootDir);
    const defaultPath = path.resolve(this.rootDir, ".cache", "ado-dashboard-cache.json");
    const targetPath = cacheFilePath ? path.resolve(cacheFilePath) : defaultPath;

    if (!isSafePath(targetPath, this.rootDir)) {
      throw new Error(
        `Security Error: Cache file path '${targetPath}' traverses outside the allowed root directory '${this.rootDir}'.`
      );
    }
    this.cacheFilePath = targetPath;
  }

  getCacheFilePath(): string {
    return this.cacheFilePath;
  }

  load(): DashboardCacheData {
    if (!fs.existsSync(this.cacheFilePath)) {
      return {
        version: 1,
        orgUrl: "https://dev.azure.com/sample-org",
        project: "SampleProject",
        runs: [],
      };
    }

    if (!isSafePath(this.cacheFilePath, this.rootDir)) {
      throw new Error(
        `Security Error: Cache file path '${this.cacheFilePath}' failed safety validation.`
      );
    }

    try {
      const raw = fs.readFileSync(this.cacheFilePath, "utf-8");
      const parsed = JSON.parse(raw) as DashboardCacheData;
      if (!parsed || !Array.isArray(parsed.runs)) {
        return {
          version: 1,
          orgUrl: "https://dev.azure.com/sample-org",
          project: "SampleProject",
          runs: [],
        };
      }
      return parsed;
    } catch (err) {
      this.logger.warn(
        `⚠️ Failed to parse dashboard cache at ${this.cacheFilePath}: ${(err as Error).message}`
      );
      return {
        version: 1,
        orgUrl: "https://dev.azure.com/sample-org",
        project: "SampleProject",
        runs: [],
      };
    }
  }

  save(data: DashboardCacheData): void {
    const dir = path.dirname(this.cacheFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!isSafePath(dir, this.rootDir) || !isSafePath(this.cacheFilePath, this.rootDir)) {
      throw new Error(
        `Security Error: Refusing to write cache outside allowed workspace directory.`
      );
    }

    const serialized = JSON.stringify(data, null, 2);
    const redacted = SecretRedactor.redact(serialized);
    fs.writeFileSync(this.cacheFilePath, redacted, "utf-8");
  }

  upsertRuns(
    incomingRuns: DashboardRunRecord[],
    orgUrl: string,
    project: string,
    isDemoData: boolean = false
  ): DashboardCacheData {
    const existing = this.load();
    const runMap = new Map<number, DashboardRunRecord>();

    // If incoming data is real ADO data and existing was demo data, replace demo runs
    const baseRuns = existing.isDemoData && !isDemoData ? [] : existing.runs;

    for (const run of baseRuns) {
      runMap.set(run.runId, run);
    }
    for (const run of incomingRuns) {
      runMap.set(run.runId, run);
    }

    const mergedRuns = Array.from(runMap.values()).sort(
      (a, b) =>
        new Date(b.completedDate).getTime() - new Date(a.completedDate).getTime()
    );

    const updated: DashboardCacheData = {
      version: 1,
      orgUrl: orgUrl || existing.orgUrl,
      project: project || existing.project,
      lastSyncedAt: new Date().toISOString(),
      isDemoData,
      runs: mergedRuns,
    };

    this.save(updated);
    return updated;
  }

  static generateDemoRuns(
    orgUrl: string = "https://dev.azure.com/contoso-eng",
    project: string = "CloudCommerce",
    referenceNow: Date = new Date()
  ): DashboardRunRecord[] {
    const baseOrg = orgUrl.replace(/\/$/, "");
    const hash = (msg: string) =>
      crypto.createHash("sha256").update(msg).digest("hex");

    const errTimeout =
      "TimeoutError: Waiting for selector '#checkout-submit-btn' exceeded 30000ms at PaymentGateway.submitOrder";
    const errAuthToken =
      "AssertionError: Expected HTTP 200 but received 401 Unauthorized at OAuthTokenRefresh_TC1042";
    const errTaxRounding =
      "AssertionError: Expected VAT total 14.29 to equal 14.28 for EU cross-border cart";
    const errInventoryLock =
      "DeadlockException: Inventory reservation lock timed out on SKU-9921 during flash sale concurrency";
    const errManualSafari =
      "Manual Step 4 Failed: Apple Pay sheet fails to render on iOS 17 Safari WebView when discount code applied";

    const defects: Record<string, LinkedDefectRecord> = {
      timeout: {
        workItemId: 8412,
        workItemType: "Task",
        title: "[Flaky] [Auto] Investigate: Checkout_PaymentGateway_Timeout_TC1015",
        state: "Active",
        url: `${baseOrg}/${project}/_workitems/edit/8412`,
        isFlakyTagged: true,
      },
      auth: {
        workItemId: 8439,
        workItemType: "Bug",
        title: "[Auto] Investigate: OAuthTokenRefresh_ExpiryRace_TC1042",
        state: "Active",
        url: `${baseOrg}/${project}/_workitems/edit/8439",`,
        isFlakyTagged: false,
      },
      tax: {
        workItemId: 8451,
        workItemType: "Task",
        title: "[Auto] Investigate: TaxCalculation_EUCrossBorder_TC1088",
        state: "New",
        url: `${baseOrg}/${project}/_workitems/edit/8451`,
        isFlakyTagged: false,
      },
      safari: {
        workItemId: 8460,
        workItemType: "Bug",
        title: "Exploratory: iOS Safari Apple Pay sheet fails with promo code",
        state: "Active",
        url: `${baseOrg}/${project}/_workitems/edit/8460`,
        isFlakyTagged: false,
      },
    };
    defects.auth.url = `${baseOrg}/${project}/_workitems/edit/8439`;

    const catalog = [
      { id: "1011", title: "UserLogin_ValidCredentials_TC1011", baseDuration: 1250 },
      { id: "1012", title: "UserLogin_MFA_Challenge_TC1012", baseDuration: 2400 },
      { id: "1015", title: "Checkout_PaymentGateway_Timeout_TC1015", baseDuration: 18500 },
      { id: "1021", title: "Cart_AddRemoveItems_Persistence_TC1021", baseDuration: 1800 },
      { id: "1034", title: "Search_ElasticFacetFiltering_TC1034", baseDuration: 3200 },
      { id: "1042", title: "OAuthTokenRefresh_ExpiryRace_TC1042", baseDuration: 4100 },
      { id: "1055", title: "OrderHistory_PaginationExport_TC1055", baseDuration: 6400 },
      { id: "1088", title: "TaxCalculation_EUCrossBorder_TC1088", baseDuration: 2100 },
      { id: "1094", title: "Inventory_FlashSaleConcurrency_TC1094", baseDuration: 14200 },
      { id: "1102", title: "Webhook_StripeSignatureVerify_TC1102", baseDuration: 950 },
      { id: "2001", title: "Manual_Exploratory_ApplePay_Safari_TC2001", baseDuration: 185000 },
      { id: "2002", title: "Manual_Accessibility_ScreenReader_Checkout_TC2002", baseDuration: 240000 },
      { id: "2003", title: "Manual_PhysicalReceiptPrinter_POS_TC2003", baseDuration: 150000 },
      { id: "2004", title: "Manual_Localization_RTL_ArabicLayout_TC2004", baseDuration: 195000 },
    ];

    const runs: DashboardRunRecord[] = [];
    let nextRunId = 5001;
    let nextResultId = 90001;

    // Generate 28 days of rich execution history
    for (let dayOffset = 27; dayOffset >= 0; dayOffset--) {
      const dayDate = new Date(referenceNow.getTime() - dayOffset * 24 * 60 * 60 * 1000);
      const dateStr = dayDate.toISOString().slice(0, 10);

      // 1. Daily ADO Test Reporter Pipeline Run (E2E Regression)
      const buildId1 = 12000 + (28 - dayOffset) * 3;
      const buildNum1 = `202611.${28 - dayOffset}.1`;
      const run1Id = nextRunId++;
      const run1Start = new Date(dayDate.getTime() - 4 * 3600 * 1000);

      const reporterSpecs = catalog.slice(0, 10);
      const run1Results: DashboardTestResultRecord[] = reporterSpecs.map((spec, idx) => {
        let outcome: NormalizedOutcome = "Passed";
        let errorMessage: string | undefined;
        let errorHash: string | undefined;
        let linkedDefect: LinkedDefectRecord | undefined;

        // TC1015 oscillates Pass/Fail (Flaky!)
        if (spec.id === "1015" && dayOffset % 2 === 1) {
          outcome = "Failed";
          errorMessage = errTimeout;
          errorHash = hash(errTimeout);
          linkedDefect = defects.timeout;
        }
        // TC1042 regressed in the last 3 days (New Regression!)
        if (spec.id === "1042" && dayOffset <= 2) {
          outcome = "Failed";
          errorMessage = errAuthToken;
          errorHash = hash(errAuthToken);
          linkedDefect = defects.auth;
        }
        // TC1088 regressed in the last 2 days
        if (spec.id === "1088" && dayOffset <= 1) {
          outcome = "Failed";
          errorMessage = errTaxRounding;
          errorHash = hash(errTaxRounding);
          linkedDefect = defects.tax;
        }
        // TC1094 fails occasionally without a linked defect yet (shows defect coverage gap)
        if (spec.id === "1094" && (dayOffset === 0 || dayOffset === 4 || dayOffset === 9)) {
          outcome = "Failed";
          errorMessage = errInventoryLock;
          errorHash = hash(errInventoryLock);
        }

        const jitter = ((dayOffset * 137 + idx * 53) % 600) - 200;
        const durationMs = Math.max(250, spec.baseDuration + jitter);

        return {
          resultId: nextResultId++,
          runId: run1Id,
          testCaseId: spec.id,
          testCaseTitle: spec.title,
          automatedTestName: `CloudCommerce.E2E.${spec.title}`,
          outcome,
          durationMs,
          errorMessage,
          errorHash,
          completedDate: new Date(run1Start.getTime() + durationMs).toISOString(),
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
          testCaseUrl: `${baseOrg}/${project}/_workitems/edit/${spec.id}`,
          linkedDefect,
        };
      });

      runs.push(
        DashboardCacheRepository.assembleRun({
          runId: run1Id,
          name: `Run ${buildNum1} - E2E Regression Suite`,
          state: "Completed",
          startedDate: run1Start.toISOString(),
          isAutomated: true,
          executionSource: "pipeline",
          executionSubSource: "ado_test_reporter",
          planId: 301,
          planName: "Release 2026.4 Master Plan",
          suiteId: 3011,
          suiteName: "E2E Regression Suite",
          buildId: buildId1,
          buildNumber: buildNum1,
          ownerName: "Azure Pipelines (ADO Test Reporter)",
          baseOrg,
          project,
          results: run1Results,
        })
      );

      // 2. Native Azure Pipeline Run (API & Unit Integration via VSTest/PublishTestResults)
      if (dayOffset % 2 === 0 || dayOffset <= 5) {
        const buildId2 = buildId1 + 1;
        const buildNum2 = `202611.${28 - dayOffset}.2-ci`;
        const run2Id = nextRunId++;
        const run2Start = new Date(dayDate.getTime() - 2 * 3600 * 1000);
        const ciSpecs = [catalog[0], catalog[1], catalog[3], catalog[4], catalog[5], catalog[9]];

        const run2Results: DashboardTestResultRecord[] = ciSpecs.map((spec, idx) => {
          let outcome: NormalizedOutcome = "Passed";
          let errorMessage: string | undefined;
          let errorHash: string | undefined;
          let linkedDefect: LinkedDefectRecord | undefined;

          if (spec.id === "1042" && dayOffset <= 1) {
            outcome = "Failed";
            errorMessage = errAuthToken;
            errorHash = hash(errAuthToken);
            linkedDefect = defects.auth;
          }

          const durationMs = Math.max(180, Math.round(spec.baseDuration * 0.65) + idx * 45);
          return {
            resultId: nextResultId++,
            runId: run2Id,
            testCaseId: spec.id,
            testCaseTitle: spec.title,
            automatedTestName: `CloudCommerce.API.${spec.title}`,
            outcome,
            durationMs,
            errorMessage,
            errorHash,
            completedDate: new Date(run2Start.getTime() + durationMs).toISOString(),
            executionSource: "pipeline",
            executionSubSource: "azure_pipeline",
            testCaseUrl: `${baseOrg}/${project}/_workitems/edit/${spec.id}`,
            linkedDefect,
          };
        });

        runs.push(
          DashboardCacheRepository.assembleRun({
            runId: run2Id,
            name: `CI API Smoke - Build ${buildNum2}`,
            state: "Completed",
            startedDate: run2Start.toISOString(),
            isAutomated: true,
            executionSource: "pipeline",
            executionSubSource: "azure_pipeline",
            planId: 302,
            planName: "Continuous Integration Smoke Plan",
            suiteId: 3021,
            suiteName: "API Fast Feedback",
            buildId: buildId2,
            buildNumber: buildNum2,
            ownerName: "GitHub / Azure Pipelines Agent",
            baseOrg,
            project,
            results: run2Results,
          })
        );
      }

      // 3. Direct ADO Execution (Manual / Exploratory Test Runs executed directly in ADO Test Plans UI)
      if (dayOffset % 3 === 0 || dayOffset <= 3) {
        const run3Id = nextRunId++;
        const run3Start = new Date(dayDate.getTime() - 1 * 3600 * 1000);
        const manualSpecs = catalog.slice(10, 14);

        const run3Results: DashboardTestResultRecord[] = manualSpecs.map((spec, idx) => {
          let outcome: NormalizedOutcome = "Passed";
          let errorMessage: string | undefined;
          let errorHash: string | undefined;
          let linkedDefect: LinkedDefectRecord | undefined;

          // Manual Safari ApplePay test fails on recent runs
          if (spec.id === "2001" && (dayOffset === 0 || dayOffset === 3 || dayOffset === 9)) {
            outcome = "Failed";
            errorMessage = errManualSafari;
            errorHash = hash(errManualSafari);
            linkedDefect = defects.safari;
          } else if (spec.id === "2003" && dayOffset === 2) {
            outcome = "Blocked";
            errorMessage = "POS thermal printer hardware unavailable in staging lab";
          }

          const durationMs = spec.baseDuration + ((dayOffset + idx) % 4) * 12000;
          return {
            resultId: nextResultId++,
            runId: run3Id,
            testCaseId: spec.id,
            testCaseTitle: spec.title,
            outcome,
            durationMs,
            errorMessage,
            errorHash,
            completedDate: new Date(run3Start.getTime() + durationMs).toISOString(),
            executionSource: "direct_ado",
            executionSubSource: "direct_manual",
            testCaseUrl: `${baseOrg}/${project}/_workitems/edit/${spec.id}`,
            linkedDefect,
          };
        });

        runs.push(
          DashboardCacheRepository.assembleRun({
            runId: run3Id,
            name: `Manual Exploratory & UAT Sign-off (${dateStr})`,
            state: "Completed",
            startedDate: run3Start.toISOString(),
            isAutomated: false,
            executionSource: "direct_ado",
            executionSubSource: "direct_manual",
            planId: 301,
            planName: "Release 2026.4 Master Plan",
            suiteId: 3015,
            suiteName: "UAT & Exploratory Sign-off",
            ownerName: dayOffset % 2 === 0 ? "Priya Nair (QA Lead)" : "Alex Rivera (Exploratory QA)",
            baseOrg,
            project,
            results: run3Results,
          })
        );
      }
    }

    return runs.sort(
      (a, b) =>
        new Date(b.completedDate).getTime() - new Date(a.completedDate).getTime()
    );
  }

  private static assembleRun(params: {
    runId: number;
    name: string;
    state: string;
    startedDate: string;
    isAutomated: boolean;
    executionSource: "pipeline" | "direct_ado";
    executionSubSource: "ado_test_reporter" | "azure_pipeline" | "direct_manual";
    planId?: number;
    planName?: string;
    suiteId?: number;
    suiteName?: string;
    buildId?: number;
    buildNumber?: string;
    ownerName?: string;
    baseOrg: string;
    project: string;
    results: DashboardTestResultRecord[];
  }): DashboardRunRecord {
    const totalTests = params.results.length;
    const passedTests = params.results.filter((r) => r.outcome === "Passed").length;
    const failedTests = params.results.filter((r) => r.outcome === "Failed").length;
    const blockedTests = params.results.filter((r) => r.outcome === "Blocked").length;
    const notExecutedTests = params.results.filter(
      (r) => r.outcome === "NotExecuted"
    ).length;
    const otherTests =
      totalTests - passedTests - failedTests - blockedTests - notExecutedTests;

    const durationMs = params.results.reduce((acc, r) => acc + r.durationMs, 0);
    const completedDate = new Date(
      new Date(params.startedDate).getTime() + durationMs
    ).toISOString();
    const passRate =
      totalTests > 0 ? Number(((passedTests / totalTests) * 100).toFixed(1)) : 0;

    return {
      runId: params.runId,
      name: params.name,
      state: params.state,
      startedDate: params.startedDate,
      completedDate,
      durationMs,
      isAutomated: params.isAutomated,
      executionSource: params.executionSource,
      executionSubSource: params.executionSubSource,
      planId: params.planId,
      planName: params.planName,
      suiteId: params.suiteId,
      suiteName: params.suiteName,
      buildId: params.buildId,
      buildNumber: params.buildNumber,
      ownerName: params.ownerName,
      totalTests,
      passedTests,
      failedTests,
      blockedTests,
      notExecutedTests,
      otherTests,
      passRate,
      runUrl: `${params.baseOrg}/${params.project}/_testManagement/runs?runId=${params.runId}`,
      buildUrl: params.buildId
        ? `${params.baseOrg}/${params.project}/_build/results?buildId=${params.buildId}`
        : undefined,
      planUrl: params.planId
        ? `${params.baseOrg}/${params.project}/_testPlans/execute?planId=${params.planId}${
            params.suiteId ? `&suiteId=${params.suiteId}` : ""
          }`
        : undefined,
      results: params.results,
    };
  }
}
