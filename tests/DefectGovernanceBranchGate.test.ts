import { FailureTaskService } from "../src/failureTaskService";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import { ILogger } from "../src/interfaces/ILogger";
import { ExecutionProvenance } from "../src/interfaces/IAuditManifest";

describe("FailureTaskService Defect Governance & Branch Gating", () => {
    let mockWorkItemApi: jest.Mocked<Partial<IWorkItemTrackingApi>>;
    let mockLogger: jest.Mocked<ILogger>;

    beforeEach(() => {
        mockLogger = {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };

        mockWorkItemApi = {
            queryByWiql: jest.fn(),
            getWorkItem: jest.fn(),
            updateWorkItem: jest.fn(),
            createWorkItem: jest.fn(),
            createAttachment: jest.fn(),
        };
    });

    it("should allow auto-resolution on main branch and apply target state and audit comment", async () => {
        const service = new FailureTaskService(
            mockWorkItemApi as IWorkItemTrackingApi,
            "MyProject",
            "https://dev.azure.com/myorg",
            mockLogger,
            "Task",
            ["main", "master", "release/*"],
            "Resolved",
            "main"
        );

        // Mock findTaskByLinkedTestCase returning taskId 500
        mockWorkItemApi.queryByWiql = jest.fn().mockResolvedValue({
            workItemRelations: [
                { source: { id: 500 }, target: { id: 101 } },
            ],
        });

        // Mock getWorkItem returning relations
        mockWorkItemApi.getWorkItem = jest.fn().mockResolvedValue({
            id: 500,
            relations: [
                {
                    rel: "System.LinkTypes.Related",
                    url: "https://dev.azure.com/myorg/MyProject/_apis/wit/workItems/101",
                },
            ],
        });

        mockWorkItemApi.updateWorkItem = jest.fn().mockResolvedValue({ id: 500 });

        const provenance: ExecutionProvenance = {
            commitSha: "c0ffee1234567890",
            branch: "refs/heads/main",
            buildId: 999,
            buildNumber: "Build-999",
            triggerActor: "release-bot",
            agentName: "agent-01",
            timestamp: new Date().toISOString(),
        };

        await service.resolveTaskForSuccess("101", "Build-999", provenance);

        expect(mockWorkItemApi.updateWorkItem).toHaveBeenCalled();
        const patchArg = (mockWorkItemApi.updateWorkItem as jest.Mock).mock.calls[0][1];

        // Should contain target state Resolved
        const statePatch = patchArg.find((p: any) => p.path === "/fields/System.State");
        expect(statePatch).toBeDefined();
        expect(statePatch.value).toBe("Resolved");

        // Should contain [AUDIT] comment with provenance
        const commentPatch = patchArg.find((p: any) => p.path === "/fields/System.History");
        expect(commentPatch).toBeDefined();
        expect(commentPatch.value).toContain("[AUDIT] Auto-resolved by ADO Test Reporter");
        expect(commentPatch.value).toContain("c0ffee1234567890");
    });

    it("should BLOCK auto-resolution when running on a feature branch", async () => {
        const service = new FailureTaskService(
            mockWorkItemApi as IWorkItemTrackingApi,
            "MyProject",
            "https://dev.azure.com/myorg",
            mockLogger,
            "Task",
            ["main", "master", "release/*"],
            "Resolved",
            "feature/experimental"
        );

        mockWorkItemApi.queryByWiql = jest.fn().mockResolvedValue({
            workItemRelations: [
                { source: { id: 500 }, target: { id: 101 } },
            ],
        });

        mockWorkItemApi.updateWorkItem = jest.fn().mockResolvedValue({ id: 500 });

        const provenance: ExecutionProvenance = {
            commitSha: "deadbeef09876543",
            branch: "feature/experimental",
            buildId: 1001,
            buildNumber: "Build-1001",
            triggerActor: "developer1",
            agentName: "local-dev",
            timestamp: new Date().toISOString(),
        };

        await service.resolveTaskForSuccess("101", "Build-1001", provenance);

        // State change must NOT have been called!
        expect(mockWorkItemApi.getWorkItem).not.toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith(
            expect.stringContaining("Governance Check: Skipping auto-close")
        );

        // Should have added an informational non-closing audit comment
        const commentCall = (mockWorkItemApi.updateWorkItem as jest.Mock).mock.calls[0];
        const commentPatch = commentCall[1][0];
        expect(commentPatch.value).toContain("Defect auto-closure is disabled by governance policy");
    });
});
