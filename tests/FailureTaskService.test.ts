import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import { FailureTaskService } from "../src/failureTaskService";
import { ILogger } from "../src/interfaces/ILogger";

class MockLogger implements ILogger {
  log(_message: string): void {}
  warn(_message: string): void {}
  error(_message: string): void {}
}

class MockWorkItemTrackingApi {
  public createWorkItemCalled = false;
  public createdTitle: string | undefined;

  async createWorkItem(_customHeaders: any, document: any, _project: string, _type: string) {
    this.createWorkItemCalled = true;
    const titleOp = document.find((op: any) => op.path === "/fields/System.Title");
    if (titleOp) {
      this.createdTitle = titleOp.value;
    }
    return { id: 123, rev: 1 };
  }

  async queryByWiql() { return { workItems: [] }; }
  async getWorkItem() { return { id: 123, rev: 1, relations: [] }; }
  async updateWorkItem() { return { id: 123, rev: 2 }; }
  async createAttachment() { return { url: "http://mock/attachment" }; }
}

describe("FailureTaskService", () => {
  it("should truncate long titles to within safe limits and create work item", async () => {
    const mockApi = new MockWorkItemTrackingApi();
    const service = new FailureTaskService(
      mockApi as unknown as IWorkItemTrackingApi,
      "Project",
      "http://org",
      new MockLogger(),
      "Task"
    );

    const longName = "A".repeat(300);
    await service.createTaskForFailure({
      testCaseId: "101",
      testName: longName,
      buildNumber: "1.0",
      runUrl: "http://run",
      runId: 1,
    });

    expect(mockApi.createWorkItemCalled).toBe(true);
    expect(mockApi.createdTitle).toBeDefined();
    expect(mockApi.createdTitle!.length).toBeLessThanOrEqual(255);
  });

  it("should sanitize malicious test names against CSV/formula injection", async () => {
    const mockApi = new MockWorkItemTrackingApi();
    const service = new FailureTaskService(
      mockApi as unknown as IWorkItemTrackingApi,
      "Project",
      "http://org",
      new MockLogger(),
      "Task"
    );

    const maliciousName = "=cmd|' /C calc'!A0";
    await service.createTaskForFailure({
      testCaseId: "102",
      testName: maliciousName,
      buildNumber: "1.0",
      runUrl: "http://run",
      runId: 2,
    });

    expect(mockApi.createWorkItemCalled).toBe(true);
    expect(mockApi.createdTitle).toContain("'=cmd");
  });
});
