import * as fs from "fs";
import * as path from "path";
import * as readline from "readline/promises";
import yargsFactory from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { isSafePath } from "./PathUtils";

export interface InitOptions {
  yes?: boolean;
  force?: boolean;
  orgUrl?: string;
  project?: string;
  defectType?: string;
  createFailureTasks?: boolean;
  autoCloseOnPass?: boolean;
  initQuarantine?: boolean;
  cwd?: string;
}

export interface InitResult {
  envPath: string;
  envWritten: boolean;
  quarantinePath?: string;
  quarantineWritten: boolean;
}

export function buildEnvTemplate(opts: {
  orgUrl: string;
  project: string;
  defectType: string;
  createFailureTasks: boolean;
  autoCloseOnPass: boolean;
}): string {
  return `# Local-only environment variables for ado-test-reporter (gitignored — never commit real tokens).
ADO_TOKEN=your-token-here
ADO_ORG_URL=${opts.orgUrl}
ADO_PROJECT=${opts.project}

# Defect & Test Plan Behavior
ADO_DEFECT_TYPE=${opts.defectType}
CREATE_FAILURE_TASKS=${opts.createFailureTasks}
ADO_AUTO_CLOSE_ON_PASS=${opts.autoCloseOnPass}
ADO_AUTO_CREATE_TEST_CASES=true
ADO_AUTO_CREATE_PLAN=true
ADO_AUTO_CREATE_SUITE=true
ADO_FALLBACK_TO_NAME_SEARCH=false
ADO_DETECT_FLAKY_TESTS=false

# Security & Governance
ADO_AUTH_TYPE=auto
ADO_AUTO_CLOSE_ALLOWED_BRANCHES=main,master,refs/heads/main,refs/heads/master,release/*
ADO_AUTO_CLOSE_TARGET_STATE=Resolved
ADO_QUARANTINE_FAIL_ON_EXPIRED=false
ADO_AUDIT_LOG_PATH=audit-events.ndjson
`;
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd || process.cwd();
  const envPath = path.resolve(cwd, ".env");
  const quarantinePath = path.resolve(cwd, "quarantine.json");

  if (!isSafePath(envPath, cwd) || !isSafePath(quarantinePath, cwd)) {
    throw new Error("Security Error: Target configuration path traverses outside working directory.");
  }

  let orgUrl = options.orgUrl || "https://dev.azure.com/your-org";
  let project = options.project || "YourProject";
  let defectType = options.defectType || "Task";
  let createFailureTasks = options.createFailureTasks ?? true;
  let autoCloseOnPass = options.autoCloseOnPass ?? false;
  let initQuarantine = options.initQuarantine ?? false;

  if (!options.yes && process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      console.log("\n🛠️  ado-test-reporter Setup Wizard\n");
      const ansOrg = (await rl.question(`Azure DevOps Org URL [${orgUrl}]: `)).trim();
      if (ansOrg) orgUrl = ansOrg;

      const ansProject = (await rl.question(`Azure DevOps Project [${project}]: `)).trim();
      if (ansProject) project = ansProject;

      const ansDefect = (await rl.question(`Defect Work Item Type (Task/Bug) [${defectType}]: `)).trim();
      if (ansDefect) defectType = ansDefect;

      const ansCreateTasks = (
        await rl.question(`Create failure tasks automatically? (true/false) [${createFailureTasks}]: `)
      ).trim();
      if (ansCreateTasks) createFailureTasks = ansCreateTasks.toLowerCase() === "true";

      const ansAutoClose = (
        await rl.question(`Auto-close open defects on pass? (true/false) [${autoCloseOnPass}]: `)
      ).trim();
      if (ansAutoClose) autoCloseOnPass = ansAutoClose.toLowerCase() === "true";

      const ansQuarantine = (
        await rl.question(`Initialize quarantine.json registry? (y/N) [N]: `)
      ).trim();
      if (ansQuarantine.toLowerCase() === "y" || ansQuarantine.toLowerCase() === "yes") {
        initQuarantine = true;
      }
    } finally {
      rl.close();
    }
  }

  let envWritten = false;
  if (!fs.existsSync(envPath) || options.force) {
    const content = buildEnvTemplate({
      orgUrl,
      project,
      defectType,
      createFailureTasks,
      autoCloseOnPass,
    });
    fs.writeFileSync(envPath, content, "utf-8");
    envWritten = true;
    console.log(`✅ Wrote configuration template to: ${envPath}`);
  } else {
    console.log(`ℹ️  Skipped .env (already exists at ${envPath}). Pass --force to overwrite.`);
  }

  let quarantineWritten = false;
  if (initQuarantine && (!fs.existsSync(quarantinePath) || options.force)) {
    const initialQuarantine = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      quarantinedTests: [],
    };
    fs.writeFileSync(quarantinePath, JSON.stringify(initialQuarantine, null, 2) + "\n", "utf-8");
    quarantineWritten = true;
    console.log(`✅ Initialized quarantine registry at: ${quarantinePath}`);
  }

  console.log(`\nNext steps:`);
  console.log(`  1. Add your Personal Access Token (ADO_TOKEN) to ${envPath}`);
  console.log(`  2. Verify connectivity & permissions: ado-test-reporter doctor`);
  console.log(`  3. Preview a JUnit sync safely:      ado-test-reporter publish --dry-run --junit-file <path/to/junit.xml>\n`);

  return {
    envPath,
    envWritten,
    quarantinePath: initQuarantine ? quarantinePath : undefined,
    quarantineWritten,
  };
}

if (require.main === module) {
  const argv = yargsFactory(hideBin(process.argv))
    .scriptName("ado-test-reporter init")
    .options({
      yes: {
        type: "boolean",
        alias: "y",
        default: false,
        describe: "Non-interactive mode using defaults and provided flags",
      },
      force: {
        type: "boolean",
        alias: "f",
        default: false,
        describe: "Overwrite existing .env or quarantine.json files",
      },
      "org-url": {
        type: "string",
        describe: "Azure DevOps Organization URL (e.g. https://dev.azure.com/my-org)",
      },
      project: {
        type: "string",
        describe: "Azure DevOps Project name",
      },
      "defect-type": {
        type: "string",
        choices: ["Task", "Bug"],
        default: "Task",
        describe: "Work item type for test failures",
      },
      "init-quarantine": {
        type: "boolean",
        default: false,
        describe: "Also initialize an empty quarantine.json file",
      },
    })
    .strict()
    .help()
    .alias("h", "help")
    .parseSync();

  runInit({
    yes: argv.yes,
    force: argv.force,
    orgUrl: argv["org-url"],
    project: argv.project,
    defectType: argv["defect-type"],
    initQuarantine: argv["init-quarantine"],
  }).catch((err) => {
    console.error("💥 Init error:", (err as Error).message || err);
    process.exit(1);
  });
}
