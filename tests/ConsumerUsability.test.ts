import * as path from "path";
import { ConfigService } from "../src/config";
import { JUnitParser } from "../src/junitParser";
import { App } from "../src/App";
import { ITestCaseService } from "../src/interfaces/ITestCaseService";
import { ITestPlanService } from "../src/interfaces/ITestPlanService";
import { IFailureTaskService } from "../src/interfaces/IFailureTaskService";
import { ITestResultParser } from "../src/interfaces/ITestResultParser";
import { ILogger } from "../src/interfaces/ILogger";

describe("Consumer Usability & Pre-flight Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.SYSTEM_ACCESSTOKEN;
    delete process.env.ADO_TOKEN;
    delete process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI;
    delete process.env.ADO_ORG_URL;
    delete process.env.SYSTEM_TEAMPROJECT;
    delete process.env.ADO_PROJECT;
    process.env.AZURE_TEST_SYNCER_ENV = path.resolve(__dirname, "__nonexistent__.env");
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("ConfigService.loadEnvironment names the exact missing environment variables", () => {
    process.env.ADO_TOKEN = "dummy-token";
    const config = new ConfigService();

    expect(() => config.loadEnvironment()).toThrow(
      /ADO_ORG_URL.*ADO_PROJECT/
    );
  });

  test("ConfigService.loadEnvironment validates ADO_ORG_URL protocol", () => {
    process.env.ADO_TOKEN = "dummy-token";
    process.env.ADO_ORG_URL = "dev.azure.com/my-org";
    process.env.ADO_PROJECT = "MyProject";
    const config = new ConfigService();

    expect(() => config.loadEnvironment()).toThrow(/Invalid ADO_ORG_URL/);
  });

  test("JUnitParser.parse gives an actionable error when the JUnit file does not exist", async () => {
    const parser = new JUnitParser();
    await expect(
      parser.parse("/tmp/nonexistent-junit-results-12345.xml")
    ).rejects.toThrow(/JUnit XML file not found.*--junit-file/);
  });

  test("App.run parses JUnit before creating/ensuring ADO Test Plan or Suite", async () => {
    const ensurePlan = jest.fn().mockResolvedValue({ planId: 1, rootSuiteId: 2 });
    const ensureSuite = jest.fn().mockResolvedValue({ suiteId: 3 });

    const mockTestCaseService = {} as ITestCaseService;
    const mockTestPlanService = { ensurePlan, ensureSuite } as unknown as ITestPlanService;
    const mockFailureTaskService = {} as IFailureTaskService;
    const mockParser: ITestResultParser = {
      parse: jest.fn().mockRejectedValue(new Error("JUnit XML file not found")),
    };
    const mockLogger: ILogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const app = new App(
      mockTestCaseService,
      mockTestPlanService,
      mockFailureTaskService,
      mockParser,
      mockLogger
    );

    await expect(
      app.run(
        {
          planName: "Smoke",
          suiteName: "Suite",
          buildId: 1,
          buildNumber: "1",
          attachResults: false,
          createFailureTasks: false,
          autoCloseOnPass: false,
        },
        "missing.xml"
      )
    ).rejects.toThrow(/JUnit XML file not found/);

    expect(ensurePlan).not.toHaveBeenCalled();
    expect(ensureSuite).not.toHaveBeenCalled();
  });

  test("App.run in dryRun mode previews results without calling ADO services", async () => {
    const ensurePlan = jest.fn();
    const ensureSuite = jest.fn();
    const createTestRun = jest.fn();
    const createFailureTask = jest.fn();

    const mockTestCaseService = {} as ITestCaseService;
    const mockTestPlanService = {
      ensurePlan,
      ensureSuite,
      createTestRun,
    } as unknown as ITestPlanService;
    const mockFailureTaskService = {
      createFailureTask,
    } as unknown as IFailureTaskService;
    const mockParser: ITestResultParser = {
      parse: jest.fn().mockResolvedValue([
        { name: "Login_TC101", outcome: "Passed", durationMs: 120 },
        { name: "Checkout_TC102", outcome: "Failed", durationMs: 300, errorMessage: "500" },
      ]),
    };
    const mockLogger: ILogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const app = new App(
      mockTestCaseService,
      mockTestPlanService,
      mockFailureTaskService,
      mockParser,
      mockLogger
    );

    const summary = await app.run(
      {
        planName: "Smoke",
        suiteName: "Suite",
        buildId: 1,
        buildNumber: "1",
        attachResults: false,
        createFailureTasks: true,
        autoCloseOnPass: true,
        dryRun: true,
      },
      "results.xml"
    );

    expect(summary?.results).toHaveLength(2);
    expect(ensurePlan).not.toHaveBeenCalled();
    expect(ensureSuite).not.toHaveBeenCalled();
    expect(createTestRun).not.toHaveBeenCalled();
    expect(createFailureTask).not.toHaveBeenCalled();
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining("[DRY RUN]")
    );
  });

  test("runInit scaffolds .env and optional quarantine.json without overwriting existing .env", async () => {
    const fs = await import("fs");
    const os = await import("os");
    const { runInit } = await import("../src/utils/initCli");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ado-init-test-"));
    try {
      const first = await runInit({
        yes: true,
        orgUrl: "https://dev.azure.com/acme",
        project: "WebApp",
        defectType: "Bug",
        initQuarantine: true,
        cwd: tmpDir,
      });

      expect(first.envWritten).toBe(true);
      expect(first.quarantineWritten).toBe(true);
      const envContent = fs.readFileSync(first.envPath, "utf-8");
      expect(envContent).toContain("ADO_ORG_URL=https://dev.azure.com/acme");
      expect(envContent).toContain("ADO_PROJECT=WebApp");
      expect(envContent).toContain("ADO_DEFECT_TYPE=Bug");
      expect(fs.existsSync(first.quarantinePath!)).toBe(true);

      // Calling again without --force should not overwrite
      const second = await runInit({
        yes: true,
        orgUrl: "https://dev.azure.com/other",
        cwd: tmpDir,
      });
      expect(second.envWritten).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("runDoctor reports missing env config and passes offline local checks when configured", async () => {
    const fs = await import("fs");
    const os = await import("os");
    const { runDoctor } = await import("../src/utils/doctorCli");

    const missingResult = await runDoctor({ offline: true });
    expect(missingResult.hasFailures).toBe(true);
    expect(
      missingResult.checks.find((c) => c.name === "Environment Config")?.status
    ).toBe("fail");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ado-doc-test-"));
    try {
      process.env.ADO_TOKEN = "dummy-token";
      process.env.ADO_ORG_URL = "https://dev.azure.com/acme";
      process.env.ADO_PROJECT = "WebApp";

      const okResult = await runDoctor({ offline: true, cwd: tmpDir });
      expect(okResult.hasFailures).toBe(false);
      expect(
        okResult.checks.find((c) => c.name === "Environment Config")?.status
      ).toBe("pass");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
