import * as fs from "fs";
import { TestPlanService } from "../src/testPlanService";
import { ITestApi } from "azure-devops-node-api/TestApi";
import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import { ILogger } from "../src/interfaces/ILogger";

describe("TestPlanService Attachment Path Traversal Protection", () => {
  const secretContent = "SECRET_CONTENT_12345";
  const secretFile = "/tmp/secret_outside_cwd_test.txt";
  const validContent = "VALID_CONTENT_ABCDE";
  const validFile = "valid_inside_cwd_test.txt";

  beforeEach(() => {
    try {
      fs.writeFileSync(secretFile, secretContent);
    } catch {
      // tmp may be restricted
    }
    fs.writeFileSync(validFile, validContent);
  });

  afterEach(() => {
    if (fs.existsSync(secretFile)) fs.unlinkSync(secretFile);
    if (fs.existsSync(validFile)) fs.unlinkSync(validFile);
  });

  it("should block secret file uploads outside CWD and allow valid files inside CWD", async () => {
    const logs: string[] = [];
    const mockLogger: ILogger = {
      log: (msg: string) => logs.push(`[LOG] ${msg}`),
      warn: (msg: string) => logs.push(`[WARN] ${msg}`),
      error: (msg: string, error?: any) => logs.push(`[ERROR] ${msg} ${error ? error : ""}`),
    };

    let leakedContent = "";
    let uploadedValidContent = "";

    const mockTestApi = {
      createTestRun: async () => ({ id: 999 }),
      addTestResultsToTestRun: async (results: any[]) => results.map((_, i) => ({ id: 100 + i })),
      createTestRunAttachment: async (attachmentRequest: any) => {
        const decoded = Buffer.from(attachmentRequest.stream, "base64").toString("utf-8");
        if (decoded === secretContent) {
          leakedContent = decoded;
        } else if (decoded === validContent) {
          uploadedValidContent = decoded;
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

    // Test 1: Path traversal attempt outside CWD
    await service.createRunAndPublish(
      1,
      "Suite",
      1,
      "Build.1",
      [],
      [],
      secretFile
    );

    // Test 2: Valid file inside CWD
    await service.createRunAndPublish(
      1,
      "Suite",
      1,
      "Build.1",
      [],
      [],
      validFile
    );

    expect(leakedContent).not.toBe(secretContent);
    expect(uploadedValidContent).toBe(validContent);
    expect(logs.some((l) => l.includes("Security Risk"))).toBe(true);
  });
});
