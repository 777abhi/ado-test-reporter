import * as path from "path";
import yargsFactory from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { loadArgs, loadEnvironment } from "./config";
import { createAzureClients } from "./azureClients";
import { parseJUnit } from "./junitParser";
import { TestCaseService } from "./testCaseService";
import { TestPlanService } from "./testPlanService";
import { FailureTaskService } from "./failureTaskService";
import { TestCaseResult } from "azure-devops-node-api/interfaces/TestInterfaces";

// Regex to extract Test Case ID from test name (e.g. "UserLogin_TC1056")
const TC_ID_REGEX = /TC(\d+)/i;

async function run() {
  const defaultJUnit = path.resolve(process.cwd(), "src/results.xml");
  const argv = yargsFactory(hideBin(process.argv))
    .options({
      "junit-file": {
        type: "string",
        demandOption: false,
        default: defaultJUnit,
        describe: `Path to JUnit XML (default: ${defaultJUnit})`,
      },
      "plan-name": {
        type: "string",
        demandOption: false,
        default: "test-plan-ado-test-reporter",
        describe: "Target Test Plan Name",
      },
      "suite-name": {
        type: "string",
        demandOption: false,
        default: "suite-name-ado-test-reporter",
        describe: "Target Test Suite Name",
      },
    })
    .parseSync();

  const env = loadEnvironment();
  const args = loadArgs(argv, defaultJUnit);
  const clients = await createAzureClients(env);

  const actualPlanName =
    args.planName.toLowerCase() === "auto-generate"
      ? `AutoPlan-${env.buildNumber || new Date().toISOString().replace(/[:.]/g, "-")}`
      : args.planName;
  const actualSuiteName =
    args.suiteName.toLowerCase() === "auto-generate"
      ? `AutoSuite-${env.buildNumber || new Date().toISOString().replace(/[:.]/g, "-")}`
      : args.suiteName;

  const testCaseService = new TestCaseService(clients.workItemApi, env.project);
  const testPlanService = new TestPlanService(
    clients.testApi,
    clients.testPlanApi,
    env.project,
    env.orgUrl
  );
  const failureTaskService = new FailureTaskService(
    clients.workItemApi,
    env.project,
    env.orgUrl
  );

  const planInfo = await testPlanService.ensurePlan(actualPlanName);
  const suiteInfo = await testPlanService.ensureSuite(
    planInfo.planId,
    planInfo.rootSuiteId,
    actualSuiteName
  );

  const parsedCases = await parseJUnit(args.junitFile);
  if (!parsedCases.length) {
    console.log("No test cases found in the JUnit file; exiting.");
    return;
  }
  console.log(`🧪 Parsed ${parsedCases.length} test cases from JUnit.`);

  const resultsToPublish: TestCaseResult[] = [];
  const testCaseIdsToLink: string[] = [];
  const failedForTask: {
    testCaseId: string;
    testName: string;
    errorMessage?: string;
  }[] = [];

  for (const tc of parsedCases) {
    const match = tc.name.match(TC_ID_REGEX);
    const resolvedTestCase = await testCaseService.resolve(
      tc.name,
      match ? match[1] : null
    );

    const resultModel: TestCaseResult = {
      testCaseTitle: tc.name,
      automatedTestName: tc.name,
      durationInMs: tc.durationMs,
      outcome: tc.outcome,
      state: "Completed",
      errorMessage: tc.errorMessage,
      testCase: { id: String(resolvedTestCase.id) },
      testCaseRevision: resolvedTestCase.revision,
    };

    testCaseIdsToLink.push(String(resolvedTestCase.id));
    resultsToPublish.push(resultModel);

    if (tc.outcome === "Failed") {
      failedForTask.push({
        testCaseId: String(resolvedTestCase.id),
        testName: tc.name,
        errorMessage: tc.errorMessage,
      });
    }
  }

  await testPlanService.linkTestCasesToSuite(
    planInfo.planId,
    suiteInfo.suiteId,
    testCaseIdsToLink
  );

  const pointIds = await testPlanService.mapPointsToResults(
    planInfo.planId,
    suiteInfo.suiteId,
    resultsToPublish
  );
  console.log(`📌 Mapped test points: ${pointIds.length} pointIds collected.`);

  const publishableResults = resultsToPublish.filter((r) => {
    console.log(
      `🔍 Result mapping: ${r.testCaseTitle} -> TC ${r.testCase?.id}, Point ${r.testPoint?.id ?? "none"}`
    );
    if (!r.testPoint?.id) {
      console.warn(
        `⚠️ Skipping result for ${r.testCaseTitle} because no test point was found (would appear as Other).`
      );
      return false;
    }
    return true;
  });

  if (publishableResults.length === 0) {
    console.warn(
      "⚠️ No results had mapped test points; run will not be published to avoid 'Other' entries."
    );
    return;
  }
  console.log(
    `✅ Publishable results: ${publishableResults.length} (of ${resultsToPublish.length} processed).`
  );

  const runInfo = await testPlanService.createRunAndPublish(
    planInfo.planId,
    actualSuiteName,
    env.buildId,
    env.buildNumber,
    publishableResults,
    pointIds
  );

  if (env.createFailureTasks) {
    for (const failure of failedForTask) {
      await failureTaskService.createTaskForFailure({
        testCaseId: failure.testCaseId,
        testName: failure.testName,
        errorMessage: failure.errorMessage,
        buildNumber: env.buildNumber,
        runUrl: runInfo.runUrl,
        runId: runInfo.runId,
      });
    }
  } else {
    console.log(
      "ℹ️ Failure task creation is disabled (CREATE_FAILURE_TASKS=false)."
    );
  }
}

run().catch((err) => {
  console.error("💥 Error during execution:", err);
  process.exit(1);
});
