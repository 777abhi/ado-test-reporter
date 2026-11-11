
import * as azureDevOps from "azure-devops-node-api";
import { IAzureClientProvider, AzureClients } from "./interfaces/IAzureClientProvider";

import { ILogger } from "./interfaces/ILogger";

export class AzureClientProvider implements IAzureClientProvider {
    private isJwtBearerToken(token: string): boolean {
        if (!token) return false;
        const trimmed = token.trim();
        const parts = trimmed.split(".");
        return parts.length === 3 && parts[0].startsWith("ey");
    }

    async createClients(
        token: string,
        orgUrl: string,
        authType: "auto" | "bearer" | "pat" | string = "auto",
        logger?: ILogger
    ): Promise<AzureClients> {
        const isBearer =
            authType.toLowerCase() === "bearer" ||
            (authType.toLowerCase() !== "pat" && this.isJwtBearerToken(token));

        if (logger) {
            if (isBearer) {
                logger.log("🔐 Authenticating with Azure DevOps using Bearer Token (Entra ID / Workload Identity).");
            } else {
                logger.log("🔐 Authenticating with Azure DevOps using Personal Access Token (PAT).");
            }
        }

        const authHandler = isBearer
            ? azureDevOps.getBearerHandler(token)
            : azureDevOps.getPersonalAccessTokenHandler(token);

        const connection = new azureDevOps.WebApi(orgUrl, authHandler);

        const testApi = await connection.getTestApi();
        const testPlanApi = await connection.getTestPlanApi();
        const workItemApi = await connection.getWorkItemTrackingApi();

        return { testApi, testPlanApi, workItemApi };
    }
}
