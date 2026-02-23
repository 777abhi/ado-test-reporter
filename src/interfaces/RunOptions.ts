export interface RunOptions {
    planName: string;
    suiteName: string;
    buildId: number;
    buildNumber: string;
    attachResults: boolean;
    createFailureTasks: boolean;
    autoCloseOnPass: boolean;
    artifactsDir?: string;
    artifactPattern?: string;
}
