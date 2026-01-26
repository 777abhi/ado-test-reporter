# ADO Test Reporter

A lightweight, robust service that bridges the gap between automated test execution and Azure DevOps Test Plans. It turns ephemeral JUnit results into persistent, traceable data—linking Test Cases, Plans, Suites, and Defects automatically.

---

## 💼 Business Perspective: Why it Matters

For Product Owners, QA Managers, and Stakeholders, this tool ensures transparency, compliance, and efficiency in the delivery pipeline.

### 1. 🛡️ Audit-Ready Traceability
Manual updates are prone to error. This tool ensures that **every test run is automatically mapped** to the corresponding Test Case in Azure DevOps.
- **Proof of Execution**: See exactly what was tested, when, and the outcome directly in ADO.
- **Compliance**: Generate isolated Test Plans/Suites per run for immutable evidence of release quality.

### 2. 📉 Reduced Manual Overhead
Eliminate the "test tax" of manually creating or updating Test Cases and logging defects.
- **Zero-Touch Sync**: New automated tests (code) automatically create or update Test Cases (documentation).
- **Auto-Triage**: Failures automatically create actionable Tasks for developers, removing the need for QA to manually log tickets.

### 3. 📖 Living Documentation
Keep your specifications and tests in sync.
- **Single Source of Truth**: With Gherkin synchronization, your feature files in Git drive the content of your Test Cases in ADO.
- **Alignment**: Ensures that the "Expected Result" in ADO always matches the latest code implementation.

### 4. 🚀 Accelerated Feedback Loop
- **Instant Notification**: Failures appear as Work Items in the backlog immediately after the pipeline runs.
- **Contextual Data**: Developers get deep links to the specific run and test case, speeding up root cause analysis.

---

## ⚙️ Technical Perspective: Key Features

For DevOps Engineers and SDETs, this tool provides a flexible, pipeline-native solution to manage test data at scale.

### 1. 🔌 Universal Compatibility (JUnit XML)
- **Language Agnostic**: Works with any test runner that outputs standard JUnit XML (Jest, PyTest, Mocha, NUnit, etc.).
- **Pipeline Native**: Runs as a lightweight Node.js CLI step in Azure Pipelines.

### 2. 🔍 Smart Test Case Resolution
The tool intelligently maps results to ADO Test Cases:
- **ID Extraction**: Parsers test names for patterns like `..._TC123` to exact match IDs.
- **Fuzzy Fallback**: If no ID is found, searches ADO for a Test Case with a matching title.
- **Auto-Provisioning**: Automatically creates new Test Cases if no match is found (configurable).

### 3. 🥒 Gherkin & BDD Synchronization
- **Feature File Parsing**: Scans `.feature` files and parses Scenarios, Backgrounds, and Examples.
- **Step Mapping**: Maps `Given`/`When` -> **Action** and `Then` -> **Expected Result**.
- **Tag Linking**: Uses tags (e.g., `@TC_123`) to target specific ADO Test Cases.

### 4. 🛠️ Automated Test Management
- **Dynamic Suites**: Automatically creates Test Plans and Static Suites. Can generate fresh "Release" suites per run.
- **Test Point Mapping**: Maps results to specific Configuration Test Points, avoiding "Other/Unplanned" noise in reports.
- **Clean Runs**: Creates, populates, and marks Test Runs as Complete automatically.

### 5. 🐛 Intelligent Defect Management
- **Auto-Task Creation**: Creates a "Task" or "Bug" work item for failed tests (Configurable).
- **Duplicate Prevention**: If an open Task exists for a test, it appends a comment with the new failure details instead of creating a duplicate.
- **Rich Context**: Links the Task to the Test Case (Related) and the Test Run (Hyperlink).
- **Auto-Close on Pass**: When a previously failed test passes in a new run, automatically resolves/closes the associated Failure Task (Configurable).

### 6. 🔗 Requirement Auto-Linking
- **RTM Automation**: Parses Requirement IDs (e.g., `Story123`, `AB#456`) from test names or Gherkin tags.
- **Traceability**: Links the Test Case to the Requirement (`Tests` / `Tested By` link) automatically.

---

## 🔮 Roadmap: Next Incremental Features

To further enhance End-to-End Traceability and workflow automation, the following features are planned:

1.  **📸 Artifact & Screenshot Support**:
    - *Logic*: Support uploading individual test attachments (screenshots, logs) to the Test Result or Failure Task.
    - *Benefit*: drastically reduces debugging time.

5.  **📉 Flaky Test Detection**:
    - *Logic*: Analyze historical outcome data before creating a failure task. If a test toggles frequently, tag it as "Flaky" instead of raising a critical defect.
    - *Benefit*: Reduces alert fatigue.

6.  **🌍 Multi-Configuration Matrix**:
    - *Logic*: Enhanced mapping for executing the same test across multiple configurations (e.g., Browser=Chrome vs Edge) in a single run.

---

## 🏗️ Architecture

This project follows **SOLID principles** to ensure maintainability and testability:
- **Service-Oriented**: Distinct services for Configuration (`ConfigService`), Test Plans (`TestPlanService`), Cases (`TestCaseService`), and Sync (`AdoSyncService`).
- **Dependency Injection**: All dependencies are injected via interfaces, making the system modular and easy to mock for unit testing.
- **Orchestrator Pattern**: The main `App` class orchestrates the workflow, keeping the entry point clean.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Azure DevOps Organization & Project
- A Personal Access Token (PAT) with Read/Write access to Work Items and Test Management.

### Installation
```bash
npm install
```

### Configuration
Create a `.env` file (or set Pipeline variables):
```ini
ADO_ORG_URL=https://dev.azure.com/myorg
ADO_PROJECT=MyProject
ADO_TOKEN=your_pat_token
# Optional Toggles
CREATE_FAILURE_TASKS=true
ADO_DEFECT_TYPE=Task # or Bug
ADO_AUTO_CLOSE_ON_PASS=true
ADO_FALLBACK_TO_NAME_SEARCH=false
ADO_AUTO_CREATE_TEST_CASES=true
```

### Usage

#### 1. Publish Test Results
```bash
npm start -- \
  --junit-file src/results.xml \
  --plan-name "Release 1.0" \
  --suite-name "Regression" \
  --attach-results
```
- Use `--plan-name auto-generate` to create a new plan for every run.

#### 2. Sync Feature Files (Gherkin)
```bash
npm run sync-features
```
- Scans `features/**/*.feature` and updates ADO Test Cases tagged with `@TC_ID`.

---

## 🔧 Pipeline Integration

Add this as a task in `azure-pipelines.yml`:

```yaml
- script: |
    npm install
    npm start -- --junit-file $(Agent.TempDirectory)/results.xml --plan-name "CI Run" --suite-name "Build $(Build.BuildId)"
  env:
    ADO_TOKEN: $(System.AccessToken)
    ADO_ORG_URL: $(System.TeamFoundationCollectionUri)
    ADO_PROJECT: $(System.TeamProject)
  displayName: 'Publish Results to ADO'
```

---

## 📚 Additional Resources

- [Core Logic Sequence Diagram](docs/sequence-diagram.md)
- [Technical Documentation](docs)
- [Screenshots & Demo](https://docs.google.com/presentation/d/1Cdk-6VaNdSHx073H-eCI7MMRfK0EcmA0/edit?usp=sharing&ouid=113003728679286380567&rtpof=true&sd=true)
