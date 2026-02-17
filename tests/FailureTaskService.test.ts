
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import { FailureTaskService } from "../src/failureTaskService";
import { ILogger } from "../src/interfaces/ILogger";

class MockLogger implements ILogger {
    log(message: string): void { console.log(message); }
    warn(message: string): void { console.warn(message); }
    error(message: string): void { console.error(message); }
}

class MockWorkItemTrackingApi {
    public createWorkItemCalled = false;
    public createdTitle: string | undefined;

    async createWorkItem(customHeaders: any, document: any, project: string, type: string) {
        this.createWorkItemCalled = true;
        // Extract title from patch document
        const titleOp = document.find((op: any) => op.path === "/fields/System.Title");
        if (titleOp) {
            this.createdTitle = titleOp.value;
        }
        return { id: 123, rev: 1 };
    }

    // Mock other methods as needed (return empty/null to avoid errors)
    async queryByWiql() { return { workItems: [] }; }
    async getWorkItem() { return { id: 123, rev: 1, relations: [] }; }
    async updateWorkItem() { return { id: 123, rev: 2 }; }
    async createAttachment() { return { url: "http://mock/attachment" }; }
}

async function runTest() {
    const mockApi = new MockWorkItemTrackingApi();
    const service = new FailureTaskService(
        mockApi as unknown as IWorkItemTrackingApi,
        "Project",
        "http://org",
        new MockLogger(),
        "Task"
    );

    const longName = "A".repeat(300);
    const maliciousName = "=cmd|' /C calc'!A0"; // CSV Injection

    console.log("Testing with long name...");
    await service.createTaskForFailure({
        testCaseId: "101",
        testName: longName,
        buildNumber: "1.0",
        runUrl: "http://run",
        runId: 1
    });

    if (!mockApi.createWorkItemCalled) {
        throw new Error("createWorkItem was not called!");
    }

    console.log("Created Title:", mockApi.createdTitle);

    if (mockApi.createdTitle && mockApi.createdTitle.length > 255) {
        throw new Error(`FAIL: Title length ${mockApi.createdTitle.length} exceeds 255 chars!`);
    } else {
        console.log("PASS: Title length is within limit.");
    }

    console.log("Testing with malicious name...");
    mockApi.createWorkItemCalled = false;
    mockApi.createdTitle = undefined;

    await service.createTaskForFailure({
        testCaseId: "102",
        testName: maliciousName,
        buildNumber: "1.0",
        runUrl: "http://run",
        runId: 2
    });

    console.log("Created Title (Malicious):", mockApi.createdTitle);

    // Expectation: [Auto] Investigate: '=cmd...
    if (!mockApi.createdTitle || !(mockApi.createdTitle as string).includes("'=cmd")) {
        throw new Error("FAIL: Malicious title was NOT sanitized (expected single quote prefix)!");
    } else {
        console.log("PASS: Malicious title sanitized.");
    }
}

if (require.main === module) {
    runTest().catch((err) => {
        console.error("Test Failed:", err);
        process.exit(1);
    });
}
