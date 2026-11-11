import * as azureDevOps from "azure-devops-node-api";
import { AzureClientProvider } from "../src/AzureClientProvider";
import { ILogger } from "../src/interfaces/ILogger";

jest.mock("azure-devops-node-api", () => {
    return {
        getPersonalAccessTokenHandler: jest.fn().mockReturnValue({ authType: "PAT" }),
        getBearerHandler: jest.fn().mockReturnValue({ authType: "Bearer" }),
        WebApi: jest.fn().mockImplementation(() => ({
            getTestApi: jest.fn().mockResolvedValue({}),
            getTestPlanApi: jest.fn().mockResolvedValue({}),
            getWorkItemTrackingApi: jest.fn().mockResolvedValue({}),
        })),
    };
});

describe("AzureClientProvider Dual Authentication", () => {
    let mockLogger: jest.Mocked<ILogger>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockLogger = {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
    });

    it("should auto-detect JWT Bearer token and call getBearerHandler", async () => {
        const provider = new AzureClientProvider();
        const jwtBearerToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozGz64oqT3zsNxfx7io";

        await provider.createClients(jwtBearerToken, "https://dev.azure.com/myorg", "auto", mockLogger);

        expect(azureDevOps.getBearerHandler).toHaveBeenCalledWith(jwtBearerToken);
        expect(azureDevOps.getPersonalAccessTokenHandler).not.toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith(
            expect.stringContaining("Bearer Token (Entra ID / Workload Identity)")
        );
    });

    it("should use getPersonalAccessTokenHandler for standard non-JWT tokens", async () => {
        const provider = new AzureClientProvider();
        const patToken = "my-ado-pat-token-1234567890abcdef";

        await provider.createClients(patToken, "https://dev.azure.com/myorg", "auto", mockLogger);

        expect(azureDevOps.getPersonalAccessTokenHandler).toHaveBeenCalledWith(patToken);
        expect(azureDevOps.getBearerHandler).not.toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith(
            expect.stringContaining("Personal Access Token (PAT)")
        );
    });

    it("should honor explicit authType 'bearer' even if token format is non-standard", async () => {
        const provider = new AzureClientProvider();
        const customToken = "custom-service-connection-token";

        await provider.createClients(customToken, "https://dev.azure.com/myorg", "bearer", mockLogger);

        expect(azureDevOps.getBearerHandler).toHaveBeenCalledWith(customToken);
    });

    it("should honor explicit authType 'pat' even if token resembles a JWT", async () => {
        const provider = new AzureClientProvider();
        const token = "eyJheader.eyPayload.signature";

        await provider.createClients(token, "https://dev.azure.com/myorg", "pat", mockLogger);

        expect(azureDevOps.getPersonalAccessTokenHandler).toHaveBeenCalledWith(token);
    });
});
