import * as fs from "fs";
import * as path from "path";
import { TestPlanService } from "../src/testPlanService";
import { ITestApi } from "azure-devops-node-api/TestApi";
import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import { ILogger } from "../src/interfaces/ILogger";

describe("TestPlanService Symlink Path Traversal Protection", () => {
  const rootDir = process.cwd();
  const restrictedDir = path.join(rootDir, "restricted_test_dir");
  const publicDir = path.join(rootDir, "public_test_dir");
  const secretFile = path.join(restrictedDir, "secret.txt");
  const symlinkFile = path.join(publicDir, "link_to_secret.txt");
  const secretContent = "SECRET_CONTENT_SYMLINK";

  let originalCwd: () => string;

  beforeEach(() => {
    if (!fs.existsSync(restrictedDir)) fs.mkdirSync(restrictedDir);
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
    fs.writeFileSync(secretFile, secretContent);

    try {
      if (fs.existsSync(symlinkFile)) fs.unlinkSync(symlinkFile);
      fs.symlinkSync(secretFile, symlinkFile);
    } catch {
      // Symlink may fail in environments without permissions
    }
  });

  afterEach(() => {
    if (originalCwd) process.cwd = originalCwd;
    if (fs.existsSync(symlinkFile)) fs.unlinkSync(symlinkFile);
    if (fs.existsSync(secretFile)) fs.unlinkSync(secretFile);
    if (fs.existsSync(restrictedDir)) fs.rmdirSync(restrictedDir);
    if (fs.existsSync(publicDir)) fs.rmdirSync(publicDir);
  });

  it("should block uploading attachments via symlinks traversing outside allowed CWD", async () => {
    if (!fs.existsSync(symlinkFile)) {
      // If symlink creation not supported, pass
      return;
    }

    const logs: string[] = [];
    const mockLogger: ILogger = {
      log: (msg: string) => logs.push(`[LOG] ${msg}`),
      warn: (msg: string) => logs.push(`[WARN] ${msg}`),
      error: (msg: string, error?: any) => logs.push(`[ERROR] ${msg} ${error ? error : ""}`),
    };

    let leakedContent = "";
    const mockTestApi = {
      createTestRun: async () => ({ id: 999 }),
      addTestResultsToTestRun: async (results: any[]) => results.map((_, i) => ({ id: 100 + i })),
      createTestRunAttachment: async (attachmentRequest: any) => {
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

    originalCwd = process.cwd;
    process.cwd = () => publicDir;

    await service.createRunAndPublish(
      1,
      "Suite",
      1,
      "Build.1",
      [],
      [],
      "link_to_secret.txt"
    );

    expect(leakedContent).not.toBe(secretContent);
    const warningFound = logs.some((l) => l.includes("Security Risk") || l.includes("traverses outside"));
    expect(warningFound).toBe(true);
  });
});
