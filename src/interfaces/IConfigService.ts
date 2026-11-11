
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
    detectFlakyTests: boolean;
    commitSha: string;
    branch: string;
    buildUri: string;
    triggerActor: string;
    agentName: string;
    authType: "auto" | "bearer" | "pat" | string;
    autoCloseAllowedBranches: string[];
    autoCloseTargetState: string;
    quarantineFailOnExpired: boolean;
    auditLogPath: string;
};

export type AppArgs = {
    junitFile: string;
    planName: string;
    suiteName: string;
    attachResults: boolean;
    artifactsDir?: string;
    artifactPattern?: string;
    generateDashboard?: boolean;
    dashboardDays?: number;
    dashboardOutput?: string;
    auditEvidenceOutput?: string;
};

export interface IConfigService {
    loadEnvironment(): AppEnv;
    loadArgs(argv: any, defaultJUnit: string): AppArgs;
}
