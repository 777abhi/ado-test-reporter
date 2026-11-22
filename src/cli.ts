#!/usr/bin/env node
import * as path from "path";
import * as fs from "fs";

export type CliCommand =
  | "publish"
  | "sync-features"
  | "import-excel"
  | "dashboard"
  | "quarantine"
  | "pr-gate"
  | "fetch-variable-group"
  | "init"
  | "doctor";

const COMMAND_MODULES: Record<CliCommand, string> = {
  publish: "./index",
  "sync-features": "./utils/syncFeaturesToAdo",
  "import-excel": "./utils/importExcel",
  dashboard: "./utils/runDashboard",
  quarantine: "./utils/quarantineCli",
  "pr-gate": "./utils/prGateCli",
  "fetch-variable-group": "./utils/fetchVariableGroup",
  init: "./utils/initCli",
  doctor: "./utils/doctorCli",
};

export interface CliDispatchResult {
  action: "help" | "version" | "run";
  command?: CliCommand;
  modulePath?: string;
  forwardedArgs: string[];
}

export function resolveCliDispatch(args: string[]): CliDispatchResult {
  if (args.length === 0) {
    return { action: "help", forwardedArgs: [] };
  }

  const first = args[0];

  if (first === "--version" || first === "-v") {
    return { action: "version", forwardedArgs: [] };
  }

  if (first === "help" || first === "--help" || first === "-h") {
    return { action: "help", forwardedArgs: [] };
  }

  if (Object.prototype.hasOwnProperty.call(COMMAND_MODULES, first)) {
    const cmd = first as CliCommand;
    return {
      action: "run",
      command: cmd,
      modulePath: COMMAND_MODULES[cmd],
      forwardedArgs: args.slice(1),
    };
  }

  // Default fallback: treat flags as `publish` subcommand for backward compatibility
  return {
    action: "run",
    command: "publish",
    modulePath: COMMAND_MODULES.publish,
    forwardedArgs: args,
  };
}

function getPackageVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  console.log(`ado-test-reporter v${getPackageVersion()}

Usage:
  ado-test-reporter [command] [options]

Commands:
  init                  Interactive setup wizard to scaffold .env & quarantine.json
  doctor                Verify Node.js, .env config, and Azure DevOps connectivity
  publish               Publish JUnit XML results to Azure Test Plans (default)
  sync-features         Sync Gherkin .feature files to Azure DevOps Test Cases
  import-excel          Import Test Cases from an Excel (.xlsx) workbook
  dashboard             Serve or export the Test Runs Insights Dashboard
  quarantine            Manage flaky test quarantine entries and TTLs
  pr-gate               Evaluate Azure Repos PR Quality Gate
  fetch-variable-group  Export an Azure DevOps Variable Group to .env

Examples:
  ado-test-reporter init
  ado-test-reporter doctor
  ado-test-reporter publish --junit-file src/results.xml --plan-name "Smoke" --dry-run
  ado-test-reporter dashboard --mode export --days 30
  ado-test-reporter pr-gate --pr-id 123
  ado-test-reporter <command> --help
`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dispatch = resolveCliDispatch(args);

  if (dispatch.action === "version") {
    console.log(getPackageVersion());
    process.exit(0);
  }

  if (dispatch.action === "help") {
    printHelp();
    process.exit(0);
  }

  if (dispatch.action === "run" && dispatch.modulePath) {
    process.argv = [process.argv[0], process.argv[1], ...dispatch.forwardedArgs];
    require(dispatch.modulePath);
  }
}
