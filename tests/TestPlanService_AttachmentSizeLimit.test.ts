import * as fs from "fs";
import { TestPlanService } from "../src/testPlanService";
import { ITestApi } from "azure-devops-node-api/TestApi";
import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import { ILogger } from "../src/interfaces/ILogger";

describe("TestPlanService Attachment Size Limit", () => {
  const largeFile = "large_file_test.bin";
  const smallFile = "small_file_test.txt";
  const LARGE_SIZE = 51 * 1024 * 1024;

  beforeEach(() => {
    try {
      const fd = fs.openSync(largeFile, "w");
      fs.ftruncateSync(fd, LARGE_SIZE);
      fs.closeSync(fd);
    } catch {
      // sparse file support
    }
    fs.writeFileSync(smallFile, "SMALL_CONTENT");
  });

  afterEach(() => {
    if (fs.existsSync(largeFile)) fs.unlinkSync(largeFile);
    if (fs.existsSync(smallFile)) fs.unlinkSync(smallFile);
  });

  it("should block files exceeding 50MB and allow small files", async () => {
    const logs: string[] = [];
    const mockLogger: ILogger = {
      log: (msg: string) => logs.push(`[LOG] ${msg}`),
      warn: (msg: string) => logs.push(`[WARN] ${msg}`),
      error: (msg: string, error?: any) => logs.push(`[ERROR] ${msg} ${error ? error : ""}`),
    };

    const uploadedFiles: string[] = [];
    const mockTestApi = {
      createTestRun: async () => ({ id: 999 }),
      addTestResultsToTestRun: async (results: any[]) => results.map((_, i) => ({ id: 100 + i })),
      createTestRunAttachment: async (attachmentRequest: any) => {
        uploadedFiles.push(attachmentRequest.fileName);
      },
      createTestResultAttachment: async (attachmentRequest: any) => {
        uploadedFiles.push(attachmentRequest.fileName);
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

    // 1. Run Attachment with large file
    await service.createRunAndPublish(
      1,
      "Suite",
      1,
      "Build.1",
      [],
      [],
      largeFile
    );

    // 2. Result Attachment with large and small file
    const results = [
      {
        testCaseTitle: "TC1",
        automatedTestName: "TC1",
        durationInMs: 100,
        outcome: "Passed",
        state: "Completed",
        localAttachments: [largeFile, smallFile],
      },
    ];

    await service.createRunAndPublish(
      1,
      "Suite",
      1,
      "Build.1",
      results as any,
      [],
      undefined
    );

    expect(uploadedFiles.includes(largeFile)).toBe(false);
    expect(uploadedFiles.includes(smallFile)).toBe(true);
    expect(logs.some((l) => l.includes("too large") || l.includes("Skipping"))).toBe(true);
  });
});
