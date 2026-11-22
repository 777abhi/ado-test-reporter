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
});
