# ADO Test Reporter

TypeScript utility that reads JUnit XML and syncs results to Azure Test Plans: it reuses or creates Test Cases, links them to a suite, resolves Test Points, and publishes a test run.

Project layout

- src/index.ts — Entry point (bootstraps App)
- src/App.ts — Main application orchestrator
- src/config.ts — ConfigService implementation
- src/AzureClientProvider.ts — Azure DevOps client factory
- src/junitParser.ts — JUnit parser
- src/testCaseService.ts — TestCaseService implementation
- src/testPlanService.ts — TestPlanService implementation
- src/failureTaskService.ts — FailureTaskService implementation
- src/interfaces/ — Service interfaces (IConfigService, ITestCaseService, etc.)
- src/results.xml — sample JUnit with TC ids (e.g., name="testLogin_TC801")
- azure-pipelines.yml — pipeline example using ts-node
- .env.example — local-only secret template (.env is gitignored)

Prerequisites

- Node 18+
- Azure DevOps token with Test Plan permissions (see Permissions)

Install

```node
npm install
```

Local configuration

1. Copy `.env.example` to `.env` (gitignored).
2. Set:

```env
ADO_TOKEN=your-token
ADO_ORG_URL=https://dev.azure.com/your-org
ADO_PROJECT=YourProject
# optional
ADO_BUILD_NUMBER=LocalRun
```

Pipeline variables are auto-read from SYSTEM*\*; locals use ADO*\*.

Run locally

```node
npm start -- \
  --junit-file src/results.xml \
  --plan-name "test-plan-ado-test-reporter" \
  --suite-name "suite-name-ado-test-reporter"
```

Flags are optional; defaults shown. JUnit test names should include TC ids matching `TC(\d+)`, e.g., `..._TC801`.
To auto-create a new plan/suite per run, set `--plan-name auto-generate` and/or `--suite-name auto-generate` (uses build number/timestamp).

How it works

- Parses JUnit cases, extracts TC ids.
- Resolves/creates Test Cases (cached per run, logs reuse).
- Ensures Test Plan and Suite exist; links only missing Test Cases to avoid duplicates.
- Fetches Test Points, maps them onto results (sets testPoint + titles), creates a run with those pointIds, publishes results, and completes the run.
- For failed tests, optionally creates Tasks to investigate (config flag below).

Pipeline (azure-pipelines.yml)

- Installs dependencies and runs `npx ts-node src/index.ts` with SYSTEM\_\* env injected (build step removed).
- Variable `CREATE_FAILURE_TASKS` (default true) controls whether tasks are created for failed tests.
- Set `TEST_PLAN_NAME=auto-generate` and/or `TEST_SUITE_NAME=auto-generate` to create fresh plan/suite per run.

Config flags

- `CREATE_FAILURE_TASKS` / `ADO_CREATE_FAILURE_TASKS`: set `false` to skip creating tasks for failed tests.
