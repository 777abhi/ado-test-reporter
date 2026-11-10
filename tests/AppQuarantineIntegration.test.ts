import * as fs from "fs";
import * as path from "path";
import { App } from "../src/App";
import { QuarantineService } from "../src/QuarantineService";
import { ITestCaseService } from "../src/interfaces/ITestCaseService";
import { ITestPlanService, TestCaseResultWithAttachments } from "../src/interfaces/ITestPlanService";
import { IFailureTaskService, FailureInfo } from "../src/interfaces/IFailureTaskService";
import { ITestResultParser, ParsedTestCase } from "../src/interfaces/ITestResultParser";
import { ILogger } from "../src/interfaces/ILogger";
import { RunOptions } from "../src/interfaces/RunOptions";

class MockLogger implements ILogger {
  logs: string[] = [];
  log(msg: string) { this.logs.push(msg); }
  warn(msg: string) { this.logs.push(msg); }
  error(msg: string) { this.logs.push(msg); }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function run() {
  console.log("Testing App Quarantine Soft-Pass Integration...");

  const logger = new MockLogger();
  const testQuarantinePath = path.resolve(process.cwd(), ".cache", "test-app-quarantine.json");
  if (fs.existsSync(testQuarantinePath)) {
    fs.unlinkSync(testQuarantinePath);
  }

  const quarantineService = new QuarantineService(logger, testQuarantinePath);
  // Quarantine test 1015
  quarantineService.quarantineTest({
    testCaseId: "1015",
    testCaseTitle: "Payment_Timeout_TC1015",
    reason: "Intermittent network flake",
    healingThreshold: 3,
  });

  const parsedCases: ParsedTestCase[] = [
    {
      name: "Payment_Timeout_TC1015",
      durationMs: 120,
      outcome: "Failed",
      errorMessage: "Connection timed out",
    },
    {
      name: "Cart_Checkout_TC2020",
      durationMs: 95,
      outcome: "Failed",
      errorMessage: "Null pointer exception",
    },
    {
      name: "Login_Success_TC3030",
      durationMs: 50,
      outcome: "Passed",
    },
  ];

  const createdTasks: FailureInfo[] = [];
  const publishedResults: TestCaseResultWithAttachments[] = [];

  const mockTestCaseService: ITestCaseService = {
    resolve: async (name: string, id: string | null) => {
      const tcId = id ? parseInt(id, 10) : 999;
      return { id: tcId, revision: 1 };
    },
  } as any;

  const mockTestPlanService: ITestPlanService = {
    ensurePlan: async () => ({ planId: 1, rootSuiteId: 10 }),
    ensureSuite: async () => ({ suiteId: 20 }),
    linkTestCasesToSuite: async () => {},
    mapPointsToResults: async (_p: number, _s: number, results: any[]) => {
      results.forEach((r, idx) => {
        r.testPoint = { id: 100 + idx };
      });
      return results.map((_, idx) => 100 + idx);
    },
    createRunAndPublish: async (_p: number, _s: string, _bId: number, _bNum: string, results: TestCaseResultWithAttachments[]) => {
      publishedResults.push(...results);
      return { runId: 500, runUrl: "https://dev.azure.com/runs/500" };
    },
    isTestFlaky: async () => false,
  };

  const mockFailureTaskService: IFailureTaskService = {
    createTaskForFailure: async (info: FailureInfo) => {
      createdTasks.push(info);
    },
    resolveTaskForSuccess: async () => {},
  };

  const mockParser: ITestResultParser = {
    parse: async () => parsedCases,
  };

  const app = new App(
    mockTestCaseService,
    mockTestPlanService,
    mockFailureTaskService,
    mockParser,
    logger,
    quarantineService
  );

  const runOptions: RunOptions = {
    planName: "Plan 1",
    suiteName: "Suite 1",
    buildId: 1001,
    buildNumber: "1001",
    attachResults: false,
    createFailureTasks: true,
    autoCloseOnPass: false,
  };

  await app.run(runOptions, "dummy.xml");

  // Verify:
  // 1. Quarantined failure TC1015 should NOT have a created FailureTask!
  assert(
    !createdTasks.some((t) => t.testCaseId === "1015"),
    "Quarantined test 1015 should NOT create a failure task!"
  );
  console.log("   PASS: Quarantined test failure was suppressed from task creation.");

  // 2. Normal failing test TC2020 should have created a FailureTask!
  assert(
    createdTasks.some((t) => t.testCaseId === "2020"),
    "Non-quarantined test 2020 MUST create a failure task!"
  );
  console.log("   PASS: Non-quarantined test failure created task normally.");

  // 3. Published result for TC1015 has quarantine comment
  const quarantinedResult = publishedResults.find((r) => r.testCase?.id === "1015");
  assert(
    quarantinedResult?.comment === "[Quarantined - Non-Blocking]",
    `Expected '[Quarantined - Non-Blocking]', got ${quarantinedResult?.comment}`
  );
  assert(
    Boolean(quarantinedResult?.errorMessage?.includes("[Quarantined - Soft Pass]")),
    "Expected soft pass note in error message"
  );
  console.log("   PASS: Quarantined result published with non-blocking comment.");

  // 4. Streak reset test: TC1015 failed, streak should be 0
  const record = quarantineService.getQuarantinedTest("1015");
  assert(record?.consecutivePasses === 0, "Streak should be 0 after failure");
  console.log("   PASS: Failure outcome properly recorded in quarantine state.");

  // Cleanup
  if (fs.existsSync(testQuarantinePath)) {
    fs.unlinkSync(testQuarantinePath);
  }

  console.log("🎉 App Quarantine Integration tests passed successfully!");
}

run().catch((e) => {
  console.error("App Quarantine Integration test failed:", e);
  process.exit(1);
});
