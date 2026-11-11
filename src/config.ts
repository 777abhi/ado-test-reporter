import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { AppEnv, AppArgs, IConfigService } from "./interfaces/IConfigService";
import { SecretRedactor } from "./utils/SecretRedactor";

export class ConfigService implements IConfigService {
  loadEnvironment(): AppEnv {
    // Allow local .env (gitignored) for secrets when running outside pipelines.
    const envPath = process.env.AZURE_TEST_SYNCER_ENV || path.resolve(".env");
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }

    const token = process.env.SYSTEM_ACCESSTOKEN || process.env.ADO_TOKEN || "";
    const orgUrl =
      process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI ||
      process.env.ADO_ORG_URL ||
      "";
    const project = process.env.SYSTEM_TEAMPROJECT || process.env.ADO_PROJECT || "";
    const buildId = process.env.BUILD_BUILDID
      ? parseInt(process.env.BUILD_BUILDID, 10)
      : 0;
    const buildNumber =
      process.env.BUILD_BUILDNUMBER || process.env.ADO_BUILD_NUMBER || "Local Run";
    const createFailureTasks = this.parseBoolean(
      process.env.CREATE_FAILURE_TASKS || process.env.ADO_CREATE_FAILURE_TASKS,
      true
    );

    const defectType = process.env.ADO_DEFECT_TYPE || "Task";
    const autoCloseOnPass = this.parseBoolean(process.env.ADO_AUTO_CLOSE_ON_PASS, false);

    const fallbackToNameSearch = this.parseBoolean(
      process.env.ADO_FALLBACK_TO_NAME_SEARCH,
      false
    );
    const autoCreateTestCases = this.parseBoolean(
      process.env.ADO_AUTO_CREATE_TEST_CASES,
      true
    );
    const autoCreatePlan = this.parseBoolean(process.env.ADO_AUTO_CREATE_PLAN, true);
    const autoCreateSuite = this.parseBoolean(process.env.ADO_AUTO_CREATE_SUITE, true);

    const detectFlakyTests = this.parseBoolean(process.env.ADO_DETECT_FLAKY_TESTS, false);

    const htmlFields = (process.env.ADO_HTML_FIELDS || "")
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    const commitSha =
      process.env.BUILD_SOURCEVERSION || process.env.GIT_COMMIT || "local-head";
    const branch =
      process.env.BUILD_SOURCEBRANCH ||
      process.env.BUILD_SOURCEBRANCHNAME ||
      process.env.GIT_BRANCH ||
      "local";
    const triggerActor =
      process.env.BUILD_REQUESTEDFOR ||
      process.env.BUILD_REQUESTEDFOREMAIL ||
      process.env.USER ||
      "automated-agent";
    const agentName =
      process.env.AGENT_NAME || process.env.HOSTNAME || "local-runner";
    const buildUri =
      orgUrl && project && buildId
        ? `${orgUrl.replace(/\/+$/, "")}/${project}/_build/results?buildId=${buildId}`
        : process.env.BUILD_BUILDURI || "";

    const authType = process.env.ADO_AUTH_TYPE || "auto";
    const autoCloseAllowedBranches = (
      process.env.ADO_AUTO_CLOSE_ALLOWED_BRANCHES ||
      "main,master,refs/heads/main,refs/heads/master,release/*"
    )
      .split(",")
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    const autoCloseTargetState =
      process.env.ADO_AUTO_CLOSE_TARGET_STATE || "Resolved";
    const quarantineFailOnExpired = this.parseBoolean(
      process.env.ADO_QUARANTINE_FAIL_ON_EXPIRED,
      false
    );
    const auditLogPath =
      process.env.ADO_AUDIT_LOG_PATH || "audit-events.ndjson";

    if (!token || !orgUrl || !project) {
      throw new Error(
        "Missing required environment variables (token/orgUrl/project). Provide SYSTEM_* values in pipeline or set ADO_TOKEN, ADO_ORG_URL, ADO_PROJECT locally."
      );
    }

    // Security: dynamically register authentication token into secret redactor
    SecretRedactor.registerSecret(token);

    return {
      token,
      orgUrl,
      project,
      buildId,
      buildNumber,
      createFailureTasks,
      defectType,
      autoCloseOnPass,
      fallbackToNameSearch,
      autoCreateTestCases,
      autoCreatePlan,
      autoCreateSuite,
      htmlFields,
      detectFlakyTests,
      commitSha,
      branch,
      buildUri,
      triggerActor,
      agentName,
      authType,
      autoCloseAllowedBranches,
      autoCloseTargetState,
      quarantineFailOnExpired,
      auditLogPath,
    };
  }

  loadArgs(argv: any, defaultJUnit: string): AppArgs {
    const junitFile = path.resolve(argv["junit-file"] || defaultJUnit);
    const planName = argv["plan-name"];
    const suiteName = argv["suite-name"];
    const attachResults = !!argv["attach-results"];
    const artifactsDir = argv["artifacts-dir"] ? path.resolve(argv["artifacts-dir"]) : undefined;
    const artifactPattern = argv["artifact-pattern"];
    const generateDashboard = !!argv["generate-dashboard"];
    const dashboardDays = argv["dashboard-days"] ? Number(argv["dashboard-days"]) : 30;
    const dashboardOutput = argv["dashboard-output"];
    const auditEvidenceOutput = argv["audit-evidence-output"];
    return {
      junitFile,
      planName,
      suiteName,
      attachResults,
      artifactsDir,
      artifactPattern,
      generateDashboard,
      dashboardDays,
      dashboardOutput,
      auditEvidenceOutput,
    };
  }

  private parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === "true";
  }
}
