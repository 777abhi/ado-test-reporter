
export type TestCaseInfo = { id: number; revision: number; title: string };

export interface ITestCaseService {
    resolve(testName: string, candidateId?: string | null): Promise<TestCaseInfo>;
    updateTestCase(testCaseId: number, fields: Record<string, any>): Promise<void>;
    linkRequirementsById(testCaseId: number, requirementIds: number[]): Promise<void>;
    getTestCase(id: number): Promise<TestCaseInfo | null>;
}
