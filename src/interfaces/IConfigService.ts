
export type AppEnv = {
    token: string;
    orgUrl: string;
    project: string;
    buildId: number;
    buildNumber: string;
    createFailureTasks: boolean;
    defectType: string;
    autoCloseOnPass: boolean;
    fallbackToNameSearch: boolean;
    autoCreateTestCases: boolean;
    autoCreatePlan: boolean;
    autoCreateSuite: boolean;
    htmlFields: string[];
};

export type AppArgs = {
    junitFile: string;
    planName: string;
    suiteName: string;
    attachResults: boolean;
    artifactsDir?: string;
    artifactPattern?: string;
};

export interface IConfigService {
    loadEnvironment(): AppEnv;
    loadArgs(argv: any, defaultJUnit: string): AppArgs;
}
