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

  const configService: IConfigService = new ConfigService();
  const azureClientProvider: IAzureClientProvider = new AzureClientProvider();
  const logger = new ConsoleLogger();
  const parser = new JUnitParser();

  const app = new App(configService, azureClientProvider, parser, logger);

  await app.run(argv, defaultJUnit);
}

run().catch((err) => {
  console.error("💥 Error during execution:", err);
  process.exit(1);
});
