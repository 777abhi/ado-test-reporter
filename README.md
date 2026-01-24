# ADO Test Reporter

A lightweight service that keeps automated test execution traceable in Azure DevOps. It turns JUnit results into living Test Cases, Plans, Suites, and linked Tasks for failures—so stakeholders always see what shipped, what failed, and where to act.

Why it matters (for stakeholders)

- Proof of coverage: JUnit tests are mapped to Test Cases and attached to Plans/Suites, so coverage is visible in ADO instead of hidden in pipelines.
- Faster triage: Failures auto-create/update Tasks with run links and test case references, giving engineers an actionable to-do list.
- Clean reporting: Results are published against Test Points, avoiding “Other” noise in runs and keeping dashboards trustworthy.
- Fresh runs on demand: Optional auto-generated Plans/Suites per run keep environments isolated for validation or audits.

Current Features

### 🔍 Smart Test Case Resolution
- **ID Extraction**: Automatically extracts Test Case IDs from test names using the pattern `..._TC123`.
- **Name-based Fallback**: If no ID is found or the ID doesn't exist, it searches for a Test Case by title in the project.
- **Auto-Creation**: Can automatically create new Test Cases in Azure DevOps if they don't exist (configurable).

### 🛠️ Auto-Provisioning
- **Test Plans & Suites**: Automatically creates Test Plans and Static Suites if they don't exist, or generates fresh ones per run for isolation.
- **Dynamic Linking**: Automatically links new Test Cases to the target Test Suite, ensuring the Test Plan is always up-to-date with the latest code.

### 📊 Results Publishing
- **Test Point Mapping**: Maps JUnit results to specific ADO Test Points to ensure accurate reporting against configurations.
- **Avoids "Other" Noise**: Validates mappings to prevent unlinked results from appearing as "Other" (unplanned) in ADO dashboards.
- **Run Management**: Creates, populates, and completes Test Runs automatically.

### 🐛 Defect Management
- **Auto-Task Creation**: Creates a "Task" work item for failed tests to facilitate immediate action.
- **Duplicate Prevention**: If an open Task already exists for a failure, it updates the existing Task with a comment instead of creating a duplicate.
- **Traceability**: Links the Failure Task to both the Test Case and the specific Test Run for full context.

### 📝 Feature File Synchronization
- **Gherkin Sync**: Scans `.feature` files and updates linked Azure DevOps Test Cases with latest steps and descriptions.
- **Smart Parsing**: Handles `Background` steps and `Rule` blocks, flattening them into the Test Case steps.
- **Tag-based Linking**: Uses tags like `@TC_123` to identify which ADO Test Case to update.
- **Step Conversion**: Maps `Given`, `When` to Action and `Then` to Expected Result automatically.

Roadmap: Next Incremental Features (E2E Traceability)

To further enhance End-to-End Traceability, the following features are planned:

1.  **🔄 Auto-Close on Pass**:
    - Automatically close the associated Failure Task (or Bug) when the test passes in a subsequent run, closing the defect loop.

2.  **🐞 Configurable Defect Type**:
    - Allow configuration to create "Bug" work items instead of "Task" for failures, aligning with different organizational workflows.

3.  **🔗 Requirement Auto-Linking**:
    - Parse Requirement/User Story IDs from test names (e.g., `Story123_TC456`) and automatically link the Test Case to the Requirement (Tests/Tested By link).

4.  **📸 Attachment Support**:
    - Support uploading screenshots, logs, or other artifacts from the test run to the ADO Test Result to assist in debugging.

5.  **🌍 Multi-Configuration Support**:
    - Enhanced mapping for Test Points across different configurations (e.g., Browser, OS) to support matrix testing.

Architecture

This project follows SOLID principles to ensure maintainability and testability:

- **Orchestrator Pattern**: The `App` class orchestrates the workflow, separating concerns from `index.ts`.
- **Dependency Injection**: Services and clients are injected via interfaces, making components loosely coupled.
- **Service-Oriented**: Distinct services handle Configuration, Test Cases, Test Plans, and Failure Tasks.

Quick start

1. Install dependencies: `npm install`
2. Configure `.env` (gitignored) from `.env.example` with ADO token, org URL, project.
3. Run locally:

```node
npm start -- \
  --junit-file src/results.xml \
  --plan-name "test-plan-ado-test-reporter" \
  --suite-name "suite-name-ado-test-reporter" \
  --attach-results
```

- Use `--plan-name auto-generate` / `--suite-name auto-generate` to create fresh plan/suite per run.
- Use `--attach-results` to upload the JUnit XML file as a Test Run attachment.

4. Sync Feature Files:
   `npm run sync-features`
   - Scans `features/**/*.feature` and updates ADO Test Cases tagged with `@TC_ID`.

Pipeline usage

- See `azure-pipelines.yml`: installs deps and runs `npx ts-node src/index.ts`.
- `CREATE_FAILURE_TASKS` (default true) controls whether Tasks are created for failures.
- `TEST_PLAN_NAME` / `TEST_SUITE_NAME` can be set to `auto-generate` for per-run isolation.

Other Useful links

- [Core Logic](docs/sequence-diagram.md)
- [Screen Shots](https://docs.google.com/presentation/d/1Cdk-6VaNdSHx073H-eCI7MMRfK0EcmA0/edit?usp=sharing&ouid=113003728679286380567&rtpof=true&sd=true)
- [Technical Docs](docs)
