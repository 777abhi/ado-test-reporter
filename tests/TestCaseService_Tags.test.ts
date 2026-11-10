import { TestCaseService } from "../src/testCaseService";
import { ILogger } from "../src/interfaces/ILogger";

class MockLogger implements ILogger {
  log(_message: string): void {}
  warn(_message: string): void {}
  error(_message: string): void {}
}

class MockWorkItemTrackingApi {
  public updateWorkItemCalled = false;
  public updatedTags: string | undefined;

  async updateWorkItem(_customHeaders: any, document: any[], id: number, _project: string) {
    this.updateWorkItemCalled = true;
    const tagOp = document.find((op: any) => op.path === "/fields/System.Tags");
    if (tagOp) {
      this.updatedTags = tagOp.value;
    }
    return { id, rev: 2 };
  }

  async getWorkItem(id: number) { return { id, rev: 1 }; }
}

describe("TestCaseService Tags Sanitization", () => {
  it("should sanitize individual tags in semicolon-delimited lists against CSV/formula injection", async () => {
    const mockApi = new MockWorkItemTrackingApi();
    const service = new TestCaseService(
      mockApi as any,
      "Project",
      false,
      false,
      new MockLogger()
    );

    const maliciousTags = "tag1; =cmd";
    await service.updateTestCase(123, {
      "System.Tags": maliciousTags,
    });

    expect(mockApi.updateWorkItemCalled).toBe(true);
    expect(mockApi.updatedTags).toBe("tag1; '=cmd");
  });
});
