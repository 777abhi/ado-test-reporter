
export type FailureInfo = {
    testCaseId: string;
    testName: string;
    errorMessage?: string;
    buildNumber: string;
    runUrl: string;
    runId: number;
    attachments?: string[];
};

export interface IFailureTaskService {
    createTaskForFailure(failure: FailureInfo): Promise<void>;
    resolveTaskForSuccess(testCaseId: string, buildNumber: string): Promise<void>;
}
