import { TestCaseService } from "../src/testCaseService";
import { ILogger } from "../src/interfaces/ILogger";

class MockLogger implements ILogger {
    log(message: string): void { console.log(message); }
    warn(message: string): void { console.warn(message); }
    error(message: string): void { console.error(message); }
}

class MockWorkItemTrackingApi {
    public updateWorkItemCalled = false;
    public updatedTags: string | undefined;

    async updateWorkItem(customHeaders: any, document: any[], id: number, project: string) {
        this.updateWorkItemCalled = true;
        const tagOp = document.find((op: any) => op.path === "/fields/System.Tags");
        if (tagOp) {
            this.updatedTags = tagOp.value;
        }
        return { id, rev: 2 };
    }
    // minimal implementation for other calls
    async getWorkItem(id: number) { return { id: 123, rev: 1 }; }
}

async function runTest() {
    const mockApi = new MockWorkItemTrackingApi();
    const service = new TestCaseService(
        mockApi as any,
        "Project",
        false,
        false,
        new MockLogger()
    );

    console.log("Testing with multiple tags, one malicious...");
    const maliciousTags = "tag1; =cmd";

    await service.updateTestCase(123, {
        "System.Tags": maliciousTags
    });

    if (!mockApi.updateWorkItemCalled) {
        throw new Error("updateWorkItem was not called!");
    }

    console.log("Updated Tags:", mockApi.updatedTags);

    // Expectation: tag1; '=cmd
    // Currently, it returns "tag1; =cmd" because sanitizeForCsv sees 't' as first char.
    if (mockApi.updatedTags === "tag1; =cmd") {
        throw new Error("FAIL: Malicious tag was NOT sanitized!");
    }

    if (mockApi.updatedTags === "tag1; '=cmd") {
        console.log("PASS: Malicious tag sanitized.");
    } else {
        throw new Error(`FAIL: Unexpected output: ${mockApi.updatedTags}`);
    }
}

runTest();
