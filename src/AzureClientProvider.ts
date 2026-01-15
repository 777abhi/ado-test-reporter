
import * as azureDevOps from "azure-devops-node-api";
import { IAzureClientProvider, AzureClients } from "./interfaces/IAzureClientProvider";

export class AzureClientProvider implements IAzureClientProvider {
    async createClients(token: string, orgUrl: string): Promise<AzureClients> {
        const authHandler = azureDevOps.getPersonalAccessTokenHandler(token);
        const connection = new azureDevOps.WebApi(orgUrl, authHandler);

        const testApi = await connection.getTestApi();
        const testPlanApi = await connection.getTestPlanApi();
        const workItemApi = await connection.getWorkItemTrackingApi();

        return { testApi, testPlanApi, workItemApi };
    }
}
