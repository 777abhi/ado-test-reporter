import { ITestApi } from "azure-devops-node-api/TestApi";
import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import {
  RunCreateModel,
  RunUpdateModel,
  TestCaseResult,
} from "azure-devops-node-api/interfaces/TestInterfaces";
import {
  TestPlanCreateParams,
  TestSuiteCreateParams,
  TestSuiteType,
} from "azure-devops-node-api/interfaces/TestPlanInterfaces";
import { ITestPlanService, PlanSuiteInfo, SuiteInfo } from "./interfaces/ITestPlanService";
import { ILogger } from "./interfaces/ILogger";

export class TestPlanService implements ITestPlanService {
  constructor(
    private testApi: ITestApi,
    private testPlanApi: ITestPlanApi,
    private project: string,
    private orgUrl: string,
    private autoCreatePlan: boolean,
    private autoCreateSuite: boolean,
    private logger: ILogger
  ) { }

  async ensurePlan(planName: string): Promise<PlanSuiteInfo> {
    if (this.autoCreatePlan) {
      this.logger.log(`ℹ️ Auto-create Plan is enabled. Creating new Test Plan: "${planName}"`);
      return this.createPlan(planName);
    }

    const plans = await this.testPlanApi.getTestPlans(
      this.project,
      undefined,
      undefined,
      true
    );
    const existingPlan = plans.find((p) => p.name === planName);

    if (existingPlan?.id) {
      return { planId: existingPlan.id, rootSuiteId: existingPlan.rootSuite?.id };
    }

    throw new Error(
      `Test Plan "${planName}" not found and auto-create is disabled (ADO_AUTO_CREATE_PLAN=false).`
    );
  }

  private async createPlan(planName: string): Promise<PlanSuiteInfo> {
    const newPlanParams: TestPlanCreateParams = {
      name: planName,
      areaPath: this.project,
      iteration: this.project,
    };
    const newPlan = await this.testPlanApi.createTestPlan(
      newPlanParams,
      this.project
    );
    if (!newPlan.id) {
      throw new Error("Failed to create test plan.");
    }
    return { planId: newPlan.id, rootSuiteId: newPlan.rootSuite?.id };
  }

  async ensureSuite(
    planId: number,
    planRootSuiteId: number | undefined,
    suiteName: string
  ): Promise<SuiteInfo> {
    const suites = await this.testPlanApi.getTestSuitesForPlan(
      this.project,
      planId
    );

    if (this.autoCreateSuite) {
      this.logger.log(`ℹ️ Auto-create Suite is enabled. Creating new Test Suite: "${suiteName}"`);
      return this.createSuite(planId, planRootSuiteId, suiteName, suites);
    }

    const existingSuite = suites.find((s) => s.name === suiteName);

    if (existingSuite?.id) {
      return { suiteId: existingSuite.id };
    }

    throw new Error(
      `Test Suite "${suiteName}" not found and auto-create is disabled (ADO_AUTO_CREATE_SUITE=false).`
    );
  }

  private async createSuite(
    planId: number,
    planRootSuiteId: number | undefined,
    suiteName: string,
    existingSuites: any[]
  ): Promise<SuiteInfo> {
    const rootSuite = existingSuites.find((s) => !s.parentSuite) || existingSuites[0];
    const parentSuiteId =
      rootSuite?.id ?? planRootSuiteId;
    // Note: If we are creating new, we attach to Root. If we were looking for existing parent, logic might differ, but for top level suite, attach to root.
    const parentSuiteName = rootSuite?.name || "Root Suite";

    if (!parentSuiteId) {
      throw new Error("Unable to determine root suite to attach new suite.");
    }

    const suitePayload: TestSuiteCreateParams = {
      suiteType: TestSuiteType.StaticTestSuite,
      name: suiteName,
      parentSuite: { id: parentSuiteId, name: parentSuiteName },
    };

    const newSuite = await this.testPlanApi.createTestSuite(
      suitePayload,
      this.project,
      planId
    );
    if (!newSuite.id) {
      throw new Error("Failed to create test suite.");
    }
    return { suiteId: newSuite.id };
  }

  async linkTestCasesToSuite(
    planId: number,
    suiteId: number,
    testCaseIds: string[]
  ): Promise<void> {
    if (testCaseIds.length === 0) return;

    const uniqueIds = [...new Set(testCaseIds)];
    const existingSuiteCases = await this.testApi.getTestCases(
      this.project,
      planId,
      suiteId
    );
    const existingIds = new Set(
      (existingSuiteCases || []).map((tc) => String(tc.testCase?.id))
    );

    const idsToAdd = uniqueIds.filter((id) => !existingIds.has(id));
    if (idsToAdd.length === 0) {
      this.logger.log("ℹ️ All test cases already linked to suite; skipping add.");
      return;
    }

    const idsCsv = idsToAdd.join(",");
    this.logger.log(`🔗 Linking Test Cases to Suite: ${idsCsv}`);
    await this.testApi.addTestCasesToSuite(this.project, planId, suiteId, idsCsv);
  }

  async mapPointsToResults(
    planId: number,
    suiteId: number,
    results: TestCaseResult[]
  ): Promise<number[]> {
    const points = await this.testPlanApi.getPointsList(
      this.project,
      planId,
      suiteId
    );
    const pointByTestCaseId = new Map<string, { pointId: number; title?: string }>();
    points.forEach((pt) => {
      const tcId = pt.testCaseReference?.id;
      if (tcId) {
        pointByTestCaseId.set(String(tcId), {
          pointId: pt.id,
          title: pt.testCaseReference?.name,
        });
      }
    });

    const runPointIds = new Set<number>();
    results.forEach((result) => {
      const tcId = result.testCase?.id;
      if (!tcId) return;
      const pointInfo = pointByTestCaseId.get(tcId);
      if (pointInfo) {
        result.testPoint = { id: String(pointInfo.pointId) };
        if (!result.testCaseTitle && pointInfo.title) {
          result.testCaseTitle = pointInfo.title;
        }
        runPointIds.add(pointInfo.pointId);
      } else {
        this.logger.warn(
          `⚠️ No test point found for test case ${tcId}; result will be unplanned.`
        );
      }
    });

    return Array.from(runPointIds);
  }

  async createRunAndPublish(
    planId: number,
    suiteName: string,
    buildId: number,
    buildNumber: string,
    results: TestCaseResult[],
    pointIds: number[]
  ): Promise<{ runId: number; runUrl: string }> {
    const runModel: RunCreateModel = {
      name: `Run ${buildNumber} - ${suiteName}`,
      plan: { id: String(planId) },
      // pointIds, // Removed to allow addTestResultsToTestRun to handle result creation/linking without conflict
      build: { id: String(buildId) },
      automated: true,
      configurationIds: [],
    };

    const testRun = await this.testApi.createTestRun(runModel, this.project);
    if (!testRun || !testRun.id) {
      throw new Error(`❌ Failed to create Test Run. Arguments: ${JSON.stringify(runModel)}`);
    }
    this.logger.log(`🚀 Created Test Run: ${testRun.id}`);

    if (results.length > 0) {
      const addedResults = await this.testApi.addTestResultsToTestRun(
        results,
        this.project,
        testRun.id
      );

      if (!addedResults || addedResults.length === 0) {
        throw new Error("❌ Failed to add test results to the run. No results returned from API.");
      }
      this.logger.log(`📊 Published ${addedResults.length} results.`);
    }

    const runUpdateModel: RunUpdateModel = { state: "Completed" };
    const updatedRun = await this.testApi.updateTestRun(runUpdateModel, this.project, testRun.id);

    if (!updatedRun || updatedRun.state !== "Completed") {
      throw new Error(`❌ Failed to mark run as Completed. Current state: ${updatedRun?.state}`);
    }
    this.logger.log("🏁 Run Completed Successfully.");

    const runUrl = new URL(
      `${this.project}/_testManagement/runs?runId=${testRun.id}`,
      this.orgUrl
    ).toString();

    return { runId: testRun.id, runUrl };
  }
}
