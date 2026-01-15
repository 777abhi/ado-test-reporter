
import { ITestApi } from "azure-devops-node-api/TestApi";
import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";

export interface AzureClients {
    testApi: ITestApi;
    testPlanApi: ITestPlanApi;
    workItemApi: IWorkItemTrackingApi;
}

export interface IAzureClientProvider {
    createClients(token: string, orgUrl: string): Promise<AzureClients>;
}
