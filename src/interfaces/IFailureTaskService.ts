
import { ExecutionProvenance } from "./IAuditManifest";

export type FailureInfo = {
    testCaseId: string;
    testName: string;
    errorMessage?: string;
    buildNumber: string;
    runUrl: string;
    runId: number;
    attachments?: string[];
    isFlaky?: boolean;
    provenance?: ExecutionProvenance;
};

export interface IFailureTaskService {
    createTaskForFailure(failure: FailureInfo): Promise<void>;
    resolveTaskForSuccess(testCaseId: string, buildNumber: string, provenance?: ExecutionProvenance): Promise<void>;
}
