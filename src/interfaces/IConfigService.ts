
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
};

export type AppArgs = {
    junitFile: string;
    planName: string;
    suiteName: string;
    attachResults: boolean;
};

export interface IConfigService {
    loadEnvironment(): AppEnv;
    loadArgs(argv: any, defaultJUnit: string): AppArgs;
}
