
export type TestCaseInfo = { id: number; revision: number; title: string };

export interface ITestCaseService {
    resolve(testName: string, candidateId?: string | null): Promise<TestCaseInfo>;
}
