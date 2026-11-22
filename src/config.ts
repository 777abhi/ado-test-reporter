import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { AppEnv, AppArgs, IConfigService } from "./interfaces/IConfigService";
import { SecretRedactor } from "./utils/SecretRedactor";
import { clampBatchSize, clampConcurrency } from "./utils/AsyncUtils";
import { clampMaxRetries, clampRetryBaseDelayMs } from "./utils/RetryUtils";

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
    const prGateEnabled = this.parseBoolean(process.env.ADO_PR_GATE, false);
    const prIdRaw =
      process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || process.env.ADO_PR_ID || "0";
    const prId = parseInt(prIdRaw, 10) || 0;
    const prRepositoryId =
      process.env.BUILD_REPOSITORY_ID || process.env.ADO_PR_REPOSITORY_ID || "";
    const prTargetBranch =
      process.env.SYSTEM_PULLREQUEST_TARGETBRANCH ||
      process.env.ADO_PR_TARGET_BRANCH ||
      "refs/heads/main";
    const prSourceBranch =
      process.env.SYSTEM_PULLREQUEST_SOURCEBRANCH || branch;
    const prStatusCheck = this.parseBoolean(process.env.ADO_PR_STATUS_CHECK, false);
    const concurrency = clampConcurrency(
      process.env.ADO_CONCURRENCY ? Number(process.env.ADO_CONCURRENCY) : undefined
    );
    const batchSize = clampBatchSize(
      process.env.ADO_BATCH_SIZE ? Number(process.env.ADO_BATCH_SIZE) : undefined
    );
    const maxRetries = clampMaxRetries(
      process.env.ADO_MAX_RETRIES ? Number(process.env.ADO_MAX_RETRIES) : undefined
    );
    const retryBaseDelayMs = clampRetryBaseDelayMs(
      process.env.ADO_RETRY_BASE_DELAY_MS ? Number(process.env.ADO_RETRY_BASE_DELAY_MS) : undefined
    );
    const webhookUrl = process.env.ADO_WEBHOOK_URL || undefined;
    const rawWebhookType = (process.env.ADO_WEBHOOK_TYPE || "auto").toLowerCase();
    const webhookType: "auto" | "slack" | "teams" | "json" =
      rawWebhookType === "slack" || rawWebhookType === "teams" || rawWebhookType === "json"
        ? rawWebhookType
        : "auto";
    const webhookAlways = this.parseBoolean(process.env.ADO_WEBHOOK_ALWAYS, false);
    const webhookFailOnError = this.parseBoolean(process.env.ADO_WEBHOOK_FAIL_ON_ERROR, false);

    const missing: string[] = [];
    if (!token) missing.push("ADO_TOKEN (or SYSTEM_ACCESSTOKEN)");
    if (!orgUrl) missing.push("ADO_ORG_URL (or SYSTEM_TEAMFOUNDATIONCOLLECTIONURI)");
    if (!project) missing.push("ADO_PROJECT (or SYSTEM_TEAMPROJECT)");

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variable(s): ${missing.join(", ")}. Set them in .env locally or via Azure Pipeline variables.`
      );
    }

    if (!/^https?:\/\/.+/i.test(orgUrl.trim())) {
      throw new Error(
        `Invalid ADO_ORG_URL: "${orgUrl}". Expected an http(s):// URL such as "https://dev.azure.com/your-org".`
      );
    }

    // Security: dynamically register authentication token & webhook URL into secret redactor
    SecretRedactor.registerSecret(token);
    if (webhookUrl) {
      SecretRedactor.registerSecret(webhookUrl);
    }

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
      prGateEnabled,
      prId,
      prRepositoryId,
      prTargetBranch,
      prSourceBranch,
      prStatusCheck,
      concurrency,
      batchSize,
      maxRetries,
      retryBaseDelayMs,
      webhookUrl,
      webhookType,
      webhookAlways,
      webhookFailOnError,
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
    const prGate = argv["pr-gate"] !== undefined ? !!argv["pr-gate"] : undefined;
    const prId = argv["pr-id"] !== undefined ? Number(argv["pr-id"]) : undefined;
    const prRepo = argv["pr-repo"];
    const prTargetBranch = argv["pr-target-branch"];
    const prStatusCheck =
      argv["pr-status-check"] !== undefined ? !!argv["pr-status-check"] : undefined;
    const concurrency =
      argv["concurrency"] !== undefined ? clampConcurrency(Number(argv["concurrency"])) : undefined;
    const batchSize =
      argv["batch-size"] !== undefined ? clampBatchSize(Number(argv["batch-size"])) : undefined;
    const webhookUrl = argv["webhook-url"] ? String(argv["webhook-url"]) : undefined;
    const rawArgWebhookType = argv["webhook-type"] ? String(argv["webhook-type"]).toLowerCase() : undefined;
    const webhookType =
      rawArgWebhookType === "slack" ||
      rawArgWebhookType === "teams" ||
      rawArgWebhookType === "json" ||
      rawArgWebhookType === "auto"
        ? (rawArgWebhookType as "auto" | "slack" | "teams" | "json")
        : undefined;
    const webhookAlways =
      argv["webhook-always"] !== undefined ? !!argv["webhook-always"] : undefined;
    const dryRun = argv["dry-run"] !== undefined ? !!argv["dry-run"] : undefined;
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
      prGate,
      prId,
      prRepo,
      prTargetBranch,
      prStatusCheck,
      concurrency,
      batchSize,
      webhookUrl,
      webhookType,
      webhookAlways,
      dryRun,
    };
  }

  private parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === "true";
  }
}
