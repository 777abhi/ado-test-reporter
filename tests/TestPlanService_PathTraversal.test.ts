import * as fs from "fs";
import { TestPlanService } from "../src/testPlanService";
import { ITestApi } from "azure-devops-node-api/TestApi";
import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import { ILogger } from "../src/interfaces/ILogger";

describe("TestPlanService Local Attachments Path Traversal Protection", () => {
  const secretContent = "SECRET_CONTENT_12345";
  const secretFile = "/tmp/secret_outside.txt";

  beforeEach(() => {
    try {
      fs.writeFileSync(secretFile, secretContent);
    } catch {
      // tmp may be restricted
    }
  });

  afterEach(() => {
    try {
      if (fs.existsSync(secretFile)) {
        fs.unlinkSync(secretFile);
      }
    } catch {}
  });

  it("should prevent reading and uploading local attachments traversing outside CWD", async () => {
    const mockLogger: ILogger = {
      log: (_msg: string) => {},
      warn: (_msg: string) => {},
      error: (_msg: string, _error?: any) => {},
    };

    let leakedContent = "";
    const mockTestApi = {
      createTestRun: async () => ({ id: 123 }),
      addTestResultsToTestRun: async (results: any[]) => results.map((_, i) => ({ id: 100 + i })),
      createTestResultAttachment: async (attachmentRequest: any) => {
        const decoded = Buffer.from(attachmentRequest.stream, "base64").toString("utf-8");
        if (decoded === secretContent) {
          leakedContent = decoded;
        }
      },
      updateTestRun: async () => ({ state: "Completed" }),
    } as unknown as ITestApi;

    const mockTestPlanApi = {
      getPointsList: async () => [],
    } as unknown as ITestPlanApi;

    const service = new TestPlanService(
      mockTestApi,
      mockTestPlanApi,
      "Project",
      "https://dev.azure.com/org",
      false,
      false,
      mockLogger
    );

    await service.createRunAndPublish(
      1,
      "Suite",
      1,
      "Build.1",
      [
        {
          testCaseTitle: "Malicious Test",
          automatedTestName: "Malicious Test",
          outcome: "Failed",
          localAttachments: [secretFile],
        },
      ],
      [1]
    );

    expect(leakedContent).not.toBe(secretContent);
  });
});
