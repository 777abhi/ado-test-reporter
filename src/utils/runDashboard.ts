import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import yargsFactory from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { ConsoleLogger } from "../ConsoleLogger";
import { AzureClientProvider } from "../AzureClientProvider";
import { DashboardCacheRepository } from "../DashboardCacheRepository";
import { DashboardDataService } from "../DashboardDataService";
import { DashboardHtmlGenerator } from "../DashboardHtmlGenerator";
import { DashboardServer } from "../DashboardServer";
import { DashboardFilterOptions } from "../interfaces/IDashboardService";
import { isSafePath } from "./PathUtils";
import { SecretRedactor } from "./SecretRedactor";

async function main() {
  const envPath = process.env.AZURE_TEST_SYNCER_ENV || path.resolve(".env");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  const argv = yargsFactory(hideBin(process.argv))
    .options({
      mode: {
        type: "string",
        choices: ["serve", "export"] as const,
        default: "serve",
        describe: "Run live interactive web server ('serve') or export static file ('export')",
      },
      port: {
        type: "number",
        default: Number(process.env.ADO_DASHBOARD_PORT || 4200),
        describe: "Port for the live dashboard HTTP server",
      },
      host: {
        type: "string",
        default: "127.0.0.1",
        describe: "Host interface to bind",
      },
      "start-date": {
        type: "string",
        alias: "from",
        describe: "Start date (YYYY-MM-DD)",
      },
      "end-date": {
        type: "string",
        alias: "to",
        describe: "End date (YYYY-MM-DD)",
      },
      days: {
        type: "number",
        default: 30,
        describe: "Lookback window in days if --start-date is not specified",
      },
      "plan-name": {
        type: "string",
        default: "all",
        describe: "Filter by Test Plan name",
      },
      "build-number": {
        type: "string",
        default: "all",
        describe: "Filter by Build number",
      },
      source: {
        type: "string",
        choices: ["all", "pipeline", "direct_ado"] as const,
        default: "all",
        describe: "Filter by primary execution source",
      },
      "sub-source": {
        type: "string",
        choices: [
          "all",
          "ado_test_reporter",
          "azure_pipeline",
          "direct_manual",
        ] as const,
        default: "all",
        describe: "Filter by execution runner sub-source",
      },
      sync: {
        type: "boolean",
        default: true,
        describe: "Sync latest runs from Azure DevOps if credentials are set",
      },
      demo: {
        type: "boolean",
        default: false,
        describe: "Force seed sample dataset if cache is empty",
      },
      "cache-file": {
        type: "string",
        describe: "Path to local JSON cache file",
      },
      output: {
        type: "string",
        default: "reports/ado-test-runs-dashboard.html",
        describe: "Output file path when running in export mode",
      },
      format: {
        type: "string",
        choices: ["html", "csv", "markdown"] as const,
        default: "html",
        describe: "Export format in export mode",
      },
    })
    .parseSync();

  const logger = new ConsoleLogger();

  const token = process.env.SYSTEM_ACCESSTOKEN || process.env.ADO_TOKEN || "";
  const orgUrl =
    process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI ||
    process.env.ADO_ORG_URL ||
    "https://dev.azure.com/contoso-eng";
  const project =
    process.env.SYSTEM_TEAMPROJECT ||
    process.env.ADO_PROJECT ||
    "CloudCommerce";
  const defectType = process.env.ADO_DEFECT_TYPE || "Task";

  const cacheRepo = new DashboardCacheRepository(logger, argv["cache-file"]);

  let testApi;
  let workItemApi;
  const hasLiveCredentials = Boolean(
    token &&
      (process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI || process.env.ADO_ORG_URL) &&
      (process.env.SYSTEM_TEAMPROJECT || process.env.ADO_PROJECT)
  );

  if (hasLiveCredentials && argv.sync && !argv.demo) {
    try {
      const clientProvider = new AzureClientProvider();
      const clients = await clientProvider.createClients(token, orgUrl);
      testApi = clients.testApi;
      workItemApi = clients.workItemApi;
    } catch (err) {
      logger.warn(
        `⚠️ Failed to initialize live ADO clients, using cached data: ${(err as Error).message}`
      );
    }
  }

  const dashboardService = new DashboardDataService(
    cacheRepo,
    logger,
    orgUrl,
    project,
    testApi,
    workItemApi,
    defectType
  );

  const endDateObj = argv["end-date"]
    ? new Date(`${argv["end-date"]}T23:59:59.999Z`)
    : new Date();
  const startDateObj = argv["start-date"]
    ? new Date(`${argv["start-date"]}T00:00:00.000Z`)
    : new Date(endDateObj.getTime() - argv.days * 86400000);

  if (testApi && argv.sync && !argv.demo) {
    try {
      await dashboardService.syncFromAdo(startDateObj, endDateObj);
    } catch (err) {
      logger.warn(
        `⚠️ Live ADO sync encountered an issue; falling back to local cache: ${(err as Error).message}`
      );
    }
  }

  // Ensure cache has data (if offline/no credentials or --demo, seed sample data so dashboard works out of the box)
  dashboardService.seedDemoDataIfEmpty();

  const filter: DashboardFilterOptions = {
    startDate: startDateObj.toISOString().slice(0, 10),
    endDate: endDateObj.toISOString().slice(0, 10),
    planName: argv["plan-name"],
    buildNumber: argv["build-number"],
    executionSource: argv.source as DashboardFilterOptions["executionSource"],
    executionSubSource:
      argv["sub-source"] as DashboardFilterOptions["executionSubSource"],
  };

  if (argv.mode === "export") {
    const outPath = path.resolve(argv.output);
    if (!isSafePath(outPath, process.cwd())) {
      throw new Error(
        `Security Error: Output path '${outPath}' traverses outside the working directory.`
      );
    }
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const report = dashboardService.buildReport(filter);
    const cacheData = cacheRepo.load();

    if (argv.format === "csv") {
      const csv = dashboardService.exportToCsv(report);
      fs.writeFileSync(outPath, csv, "utf-8");
    } else if (argv.format === "markdown") {
      const md = dashboardService.exportToMarkdown(report);
      fs.writeFileSync(outPath, md, "utf-8");
    } else {
      const html = DashboardHtmlGenerator.generateHtml(report, cacheData, {
        isLiveServer: false,
      });
      fs.writeFileSync(outPath, html, "utf-8");
    }

    logger.log(
      `✅ Exported ADO Test Runs Dashboard (${argv.format.toUpperCase()}) to: ${outPath}`
    );
    return;
  }

  const server = new DashboardServer(
    dashboardService,
    cacheRepo,
    logger,
    argv.port,
    argv.host
  );
  await server.start(filter);
}

if (require.main === module) {
  main().catch((err) => {
    const msg =
      typeof err === "string"
        ? err
        : (err as Error).message || JSON.stringify(err);
    console.error(
      "💥 Dashboard execution error:",
      SecretRedactor.redact(msg)
    );
    process.exit(1);
  });
}
