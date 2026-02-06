import * as path from "path";
import yargsFactory from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { ConfigService } from "../config";
import { AzureClientProvider } from "../AzureClientProvider";
import { ConsoleLogger } from "../ConsoleLogger";
import { TestCaseService } from "../testCaseService";
import { TestPlanService } from "../testPlanService";
import { ExcelImportService } from "../ExcelImportService";
import { ExcelParser } from "../ExcelParser";

async function main() {
  const argv = yargsFactory(hideBin(process.argv))
    .options({
      "file": {
        type: "string",
        demandOption: true,
        describe: "Path to Excel file",
      },
      "mapping": {
        type: "string",
        demandOption: true,
        describe: "Path to JSON mapping file",
      },
      "plan-name": {
        type: "string",
        demandOption: false,
        describe: "Target Test Plan Name",
      },
      "suite-name": {
        type: "string",
        demandOption: false,
        describe: "Target Test Suite Name",
      },
    })
    .parseSync();

  const configService = new ConfigService();
  const env = configService.loadEnvironment();

  const planName = argv["plan-name"] || process.env.ADO_PLAN_NAME || "Excel Import Plan";
  const suiteName = argv["suite-name"] || process.env.ADO_SUITE_NAME || "Imported Suite";

  const logger = new ConsoleLogger();
  const azureClientProvider = new AzureClientProvider();

  const clients = await azureClientProvider.createClients(env.token, env.orgUrl);

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

  const parser = new ExcelParser();
  const excelImportService = new ExcelImportService(
    testCaseService,
    testPlanService,
    logger,
    parser,
    env.htmlFields
  );

  try {
      await excelImportService.importTestCases(
          argv.file,
          argv.mapping,
          planName,
          suiteName
      );
  } catch (err) {
      console.error("❌ Error during Excel import:", err);
      process.exit(1);
  }
}

main();
