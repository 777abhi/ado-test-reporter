import * as path from "path";
import yargsFactory from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { ConfigService } from "./config";
import { AzureClientProvider } from "./AzureClientProvider";
import { App } from "./App";
import { IConfigService } from "./interfaces/IConfigService";
import { IAzureClientProvider } from "./interfaces/IAzureClientProvider";
import { ConsoleLogger } from "./ConsoleLogger";
import { JUnitParser } from "./junitParser";
import { TestCaseService } from "./testCaseService";
import { TestPlanService } from "./testPlanService";
import { FailureTaskService } from "./failureTaskService";
import { RunOptions } from "./interfaces/RunOptions";

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
      "attach-results": {
        type: "boolean",
        demandOption: false,
        default: false,
        describe: "Attach JUnit results XML to the Test Run",
      },
      "artifacts-dir": {
        type: "string",
        demandOption: false,
        describe: "Directory containing test artifacts (screenshots, logs)",
      },
      "artifact-pattern": {
        type: "string",
        demandOption: false,
        default: "{testName}.png",
        describe: "Pattern to match artifacts (e.g., '{testName}.png', 'screenshot-{testName}.jpg')",
      },
    })
    .parseSync();

  const configService: IConfigService = new ConfigService();
  const azureClientProvider: IAzureClientProvider = new AzureClientProvider();

  const env = configService.loadEnvironment();
  const args = configService.loadArgs(argv, defaultJUnit);

  const clients = await azureClientProvider.createClients(env.token, env.orgUrl);
  const logger = new ConsoleLogger();
  const parser = new JUnitParser();

  // Instantiate Services
  const testCaseService = new TestCaseService(
    clients.workItemApi,
    env.project,
    env.fallbackToNameSearch,
    env.autoCreateTestCases,
    logger
  );

  const testPlanService = new TestPlanService(
    clients.testApi,
    clients.testPlanApi,
    env.project,
    env.orgUrl,
    env.autoCreatePlan,
    env.autoCreateSuite,
    logger
  );

  const failureTaskService = new FailureTaskService(
    clients.workItemApi,
    env.project,
    env.orgUrl,
    logger,
    env.defectType
  );

  const app = new App(testCaseService, testPlanService, failureTaskService, parser, logger);

  const runOptions: RunOptions = {
    planName: args.planName,
    suiteName: args.suiteName,
    buildId: env.buildId,
    buildNumber: env.buildNumber,
    attachResults: args.attachResults,
    createFailureTasks: env.createFailureTasks,
    autoCloseOnPass: env.autoCloseOnPass,
    artifactsDir: args.artifactsDir,
    artifactPattern: args.artifactPattern
  };

  await app.run(runOptions, args.junitFile);
}

run().catch((err) => {
  console.error("💥 Error during execution:", err);
  process.exit(1);
});
