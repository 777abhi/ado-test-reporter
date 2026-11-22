import * as fs from "fs";
import * as path from "path";
import yargsFactory from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { ConfigService } from "../config";
import { AzureClientProvider } from "../AzureClientProvider";
import { ConsoleLogger } from "../ConsoleLogger";
import { SecretRedactor } from "./SecretRedactor";

export type DoctorCheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheckResult {
  name: string;
  status: DoctorCheckStatus;
  message: string;
}

export interface DoctorOptions {
  offline?: boolean;
  cwd?: string;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<{
  checks: DoctorCheckResult[];
  hasFailures: boolean;
}> {
  const cwd = options.cwd || process.cwd();
  const checks: DoctorCheckResult[] = [];

  // 1. Node.js version check
  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor >= 18) {
    checks.push({
      name: "Node.js Runtime",
      status: "pass",
      message: `v${process.versions.node} (>= 18.0.0 required)`,
    });
  } else {
    checks.push({
      name: "Node.js Runtime",
      status: "fail",
      message: `v${process.versions.node} is below the required Node.js 18+`,
    });
  }

  // 2. Local .env / Environment Configuration
  const configService = new ConfigService();
  let env: ReturnType<ConfigService["loadEnvironment"]> | undefined;
  try {
    env = configService.loadEnvironment();
    checks.push({
      name: "Environment Config",
      status: "pass",
      message: `Loaded org "${env.orgUrl}", project "${env.project}", authType "${env.authType}"`,
    });
  } catch (err) {
    checks.push({
      name: "Environment Config",
      status: "fail",
      message: (err as Error).message,
    });
  }

  // 3. Quarantine file validity
  const quarantinePath = path.resolve(cwd, "quarantine.json");
  if (fs.existsSync(quarantinePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(quarantinePath, "utf-8"));
      if (parsed && Array.isArray(parsed.quarantinedTests)) {
        checks.push({
          name: "Quarantine Registry",
          status: "pass",
          message: `Valid quarantine.json (${parsed.quarantinedTests.length} record(s))`,
        });
      } else {
        checks.push({
          name: "Quarantine Registry",
          status: "warn",
          message: `quarantine.json is missing a quarantinedTests array`,
        });
      }
    } catch (err) {
      checks.push({
        name: "Quarantine Registry",
        status: "fail",
        message: `Invalid JSON in quarantine.json: ${(err as Error).message}`,
      });
    }
  } else {
    checks.push({
      name: "Quarantine Registry",
      status: "pass",
      message: "No quarantine.json present (optional)",
    });
  }

  // 4. Audit log directory writability
  const auditDir = path.dirname(path.resolve(cwd, env?.auditLogPath || "audit-events.ndjson"));
  try {
    fs.accessSync(fs.existsSync(auditDir) ? auditDir : cwd, fs.constants.W_OK);
    checks.push({
      name: "Workspace Write Access",
      status: "pass",
      message: `Writable output directory: ${auditDir}`,
    });
  } catch {
    checks.push({
      name: "Workspace Write Access",
      status: "fail",
      message: `Directory is not writable: ${auditDir}`,
    });
  }

  // 5. Live Azure DevOps connectivity & schema checks
  if (options.offline) {
    checks.push({
      name: "Azure DevOps Connectivity",
      status: "warn",
      message: "Skipped (--offline mode)",
    });
  } else if (!env) {
    checks.push({
      name: "Azure DevOps Connectivity",
      status: "warn",
      message: "Skipped because required environment variables are missing",
    });
  } else {
    const logger = new ConsoleLogger();
    const provider = new AzureClientProvider();
    try {
      const clients = await provider.createClients(
        env.token,
        env.orgUrl,
        env.authType,
        logger,
        { maxRetries: env.maxRetries, baseDelayMs: env.retryBaseDelayMs }
      );

      // Verify Work Item Types & configured defectType
      try {
        const witTypes = await clients.workItemApi.getWorkItemTypes(env.project);
        const typeNames = (witTypes || []).map((t) => t.name).filter(Boolean) as string[];
        if (typeNames.includes(env.defectType)) {
          checks.push({
            name: "ADO Work Items & Defect Type",
            status: "pass",
            message: `Connected; defect type "${env.defectType}" is supported in "${env.project}"`,
          });
        } else {
          checks.push({
            name: "ADO Work Items & Defect Type",
            status: "warn",
            message: `Connected, but ADO_DEFECT_TYPE="${env.defectType}" was not found in "${env.project}" (available: ${typeNames.slice(0, 6).join(", ")})`,
          });
        }
      } catch (err) {
        checks.push({
          name: "ADO Work Items & Defect Type",
          status: "fail",
          message: SecretRedactor.redact((err as Error).message || String(err)),
        });
      }

      // Verify Test Plans API access
      try {
        await clients.testPlanApi.getTestPlans(env.project);
        checks.push({
          name: "ADO Test Plans API",
          status: "pass",
          message: `Test Management API accessible for "${env.project}"`,
        });
      } catch (err) {
        checks.push({
          name: "ADO Test Plans API",
          status: "fail",
          message: SecretRedactor.redact((err as Error).message || String(err)),
        });
      }
    } catch (err) {
      checks.push({
        name: "Azure DevOps Connectivity",
        status: "fail",
        message: SecretRedactor.redact((err as Error).message || String(err)),
      });
    }
  }

  const hasFailures = checks.some((c) => c.status === "fail");
  return { checks, hasFailures };
}

if (require.main === module) {
  const argv = yargsFactory(hideBin(process.argv))
    .scriptName("ado-test-reporter doctor")
    .options({
      offline: {
        type: "boolean",
        default: false,
        describe: "Skip live Azure DevOps API connectivity checks",
      },
    })
    .strict()
    .help()
    .alias("h", "help")
    .parseSync();

  runDoctor({ offline: argv.offline })
    .then(({ checks, hasFailures }) => {
      console.log("\n🩺 ado-test-reporter Doctor Diagnostics\n");
      for (const check of checks) {
        const icon = check.status === "pass" ? "✅" : check.status === "warn" ? "⚠️ " : "❌";
        console.log(`${icon} ${check.name}: ${check.message}`);
      }
      console.log("");
      if (hasFailures) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("💥 Doctor error:", SecretRedactor.redact((err as Error).message || String(err)));
      process.exit(1);
    });
}
