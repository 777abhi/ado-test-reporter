import * as fs from "fs";
import * as path from "path";
import { App } from "../src/App";
import { ITestCaseService } from "../src/interfaces/ITestCaseService";
import { ITestPlanService, TestCaseResultWithAttachments } from "../src/interfaces/ITestPlanService";
import { IFailureTaskService, FailureInfo } from "../src/interfaces/IFailureTaskService";
import { ITestResultParser, ParsedTestCase } from "../src/interfaces/ITestResultParser";
import { ILogger } from "../src/interfaces/ILogger";
import { RunOptions } from "../src/interfaces/RunOptions";

describe("ArtifactSupport Integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), "temp-test-artifacts-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should discover matching test artifacts and attach them to Test Result and Failure Task", async () => {
    const testName = "Test_Case_123";
    const artifactName = `${testName}.png`;
    const artifactPath = path.join(tempDir, artifactName);
    fs.writeFileSync(artifactPath, "Start of artifact content");

    const junitFile = path.join(tempDir, "results.xml");
    fs.writeFileSync(junitFile, "<testsuites></testsuites>");

    const mockLogger: ILogger = {
      log: (_msg: string) => {},
      warn: (_msg: string) => {},
      error: (_msg: string, _error?: any) => {},
    };

    const mockParser: ITestResultParser = {
      parse: async () => {
        const tc: ParsedTestCase = {
          name: testName,
          durationMs: 100,
          outcome: "Failed",
          errorMessage: "Something went wrong",
          attachments: [],
        };
        return [tc];
      },
    };

    const mockTestCaseService: ITestCaseService = {
      resolve: async () => ({ id: 101, revision: 1 }),
    } as unknown as ITestCaseService;

    let capturedResults: TestCaseResultWithAttachments[] = [];
    const mockTestPlanService: ITestPlanService = {
      ensurePlan: async () => ({ planId: 1, rootSuiteId: 10 }),
      ensureSuite: async () => ({ suiteId: 20 }),
      linkTestCasesToSuite: async () => {},
      mapPointsToResults: async (_planId: number, _suiteId: number, results: any[]) => {
        results.forEach((r: any) => (r.testPoint = { id: "999" }));
        return [999];
      },
      createRunAndPublish: async (_planId: number, _suiteName: string, _buildId: number, _buildNumber: string, results: TestCaseResultWithAttachments[]) => {
        capturedResults = results;
        return { runId: 500, runUrl: "http://dummy/run/500" };
      },
    } as unknown as ITestPlanService;

    let capturedTaskAttachments: string[] = [];
    const mockFailureTaskService: IFailureTaskService = {
      createTaskForFailure: async (failureInfo: FailureInfo) => {
        capturedTaskAttachments = failureInfo.attachments || [];
      },
      resolveTaskForSuccess: async () => {},
    } as unknown as IFailureTaskService;

    const app = new App(
      mockTestCaseService,
      mockTestPlanService,
      mockFailureTaskService,
      mockParser,
      mockLogger
    );

    const options: RunOptions = {
      planName: "Test Plan",
      suiteName: "Test Suite",
      buildId: 1,
      buildNumber: "1.0.0",
      attachResults: false,
      createFailureTasks: true,
      autoCloseOnPass: false,
      artifactsDir: tempDir,
      artifactPattern: "{testName}.png",
    };

    await app.run(options, junitFile);

    expect(capturedResults.length).toBeGreaterThan(0);
    expect(capturedResults[0].localAttachments).toBeDefined();
    expect(capturedResults[0].localAttachments![0]).toBe(artifactPath);

    expect(capturedTaskAttachments.length).toBeGreaterThan(0);
    expect(capturedTaskAttachments[0]).toBe(artifactPath);
  });
});
