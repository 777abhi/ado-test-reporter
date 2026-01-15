import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

export type AppEnv = {
  token: string;
  orgUrl: string;
  project: string;
  buildId: number;
  buildNumber: string;
  createFailureTasks: boolean;
};

export type AppArgs = {
  junitFile: string;
  planName: string;
  suiteName: string;
};

export function loadEnvironment(): AppEnv {
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
  const createFailureTasks = parseBoolean(
    process.env.CREATE_FAILURE_TASKS || process.env.ADO_CREATE_FAILURE_TASKS,
    true
  );

  if (!token || !orgUrl || !project) {
    throw new Error(
      "Missing required environment variables (token/orgUrl/project). Provide SYSTEM_* values in pipeline or set ADO_TOKEN, ADO_ORG_URL, ADO_PROJECT locally."
    );
  }

  return { token, orgUrl, project, buildId, buildNumber, createFailureTasks };
}

export function loadArgs(argv: any, defaultJUnit: string): AppArgs {
  const junitFile = path.resolve(argv["junit-file"] || defaultJUnit);
  const planName = argv["plan-name"];
  const suiteName = argv["suite-name"];
  return { junitFile, planName, suiteName };
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}
