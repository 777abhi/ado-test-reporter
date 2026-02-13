
import { TestCaseResult } from "azure-devops-node-api/interfaces/TestInterfaces";

export interface TestCaseResultWithAttachments extends TestCaseResult {
    localAttachments?: string[];
}

export type PlanSuiteInfo = {
    planId: number;
    rootSuiteId?: number;
};

export type SuiteInfo = {
    suiteId: number;
};

export interface ITestPlanService {
    ensurePlan(planName: string): Promise<PlanSuiteInfo>;
    ensureSuite(
        planId: number,
        planRootSuiteId: number | undefined,
        suiteName: string
    ): Promise<SuiteInfo>;
    linkTestCasesToSuite(
        planId: number,
        suiteId: number,
        testCaseIds: string[]
    ): Promise<void>;
    mapPointsToResults(
        planId: number,
        suiteId: number,
        results: TestCaseResult[]
    ): Promise<number[]>;
    createRunAndPublish(
        planId: number,
        suiteName: string,
        buildId: number,
        buildNumber: string,
        results: TestCaseResultWithAttachments[],
        pointIds: number[],
        attachmentPath?: string
    ): Promise<{ runId: number; runUrl: string }>;
}
