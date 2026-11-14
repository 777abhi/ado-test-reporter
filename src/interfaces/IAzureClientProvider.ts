
import { ITestApi } from "azure-devops-node-api/TestApi";
import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import { IGitApi } from "azure-devops-node-api/GitApi";

import { ILogger } from "./ILogger";

export interface AzureClients {
    testApi: ITestApi;
    testPlanApi: ITestPlanApi;
    workItemApi: IWorkItemTrackingApi;
    gitApi?: IGitApi;
}

export interface IAzureClientProvider {
    createClients(
        token: string,
        orgUrl: string,
        authType?: "auto" | "bearer" | "pat" | string,
        logger?: ILogger
    ): Promise<AzureClients>;
}
