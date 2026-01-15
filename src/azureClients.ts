import * as azureDevops from "azure-devops-node-api";
import { ITestApi } from "azure-devops-node-api/TestApi";
import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import { AppEnv } from "./config";

export type AzureClients = {
  testApi: ITestApi;
  testPlanApi: ITestPlanApi;
  workItemApi: IWorkItemTrackingApi;
};

export async function createAzureClients(env: AppEnv): Promise<AzureClients> {
  const authHandler = azureDevops.getBearerHandler(env.token);
  const connection = new azureDevops.WebApi(env.orgUrl, authHandler);

  const [testApi, testPlanApi, workItemApi] = await Promise.all([
    connection.getTestApi(),
    connection.getTestPlanApi(),
    connection.getWorkItemTrackingApi(),
  ]);

  return { testApi, testPlanApi, workItemApi };
}
