# Azure Test Syncer – Sequence (Simple View)

```mermaid
sequenceDiagram
    participant Pipeline as Azure Pipeline
    participant Syncer as Azure Test Syncer (this utility)
    participant ADO as Azure DevOps

    Pipeline->>Pipeline: Run tests → produce JUnit XML
    Pipeline->>Syncer: Invoke `ts-node src/index.ts` with JUnit file
    Syncer->>ADO: Authenticate using service connection token
    Syncer->>Syncer: Parse JUnit XML and find failed test cases
    Syncer->>ADO: For each failure, create/update Task with links
    Syncer-->>Pipeline: Log created/updated task IDs
```

- Intent: Show the minimum flow from tests to tasks when the syncer runs.
- Benefits: Keeps pipeline and ADO in sync automatically; gives fast visibility on failures without manual steps.

## Stakeholder Traceability View

```mermaid
sequenceDiagram
    participant Exec as Stakeholder/Exec
    participant Dashboard as ADO Dashboards
    participant Pipeline as CI Pipeline
    participant Syncer as Azure Test Syncer
    participant ADO as Azure DevOps (Tests & Tasks)

    Exec->>Dashboard: Review release readiness
    Dashboard-->>Exec: Show plan/suite coverage and tasks
    Pipeline->>Pipeline: Run automated tests → JUnit XML
    Pipeline->>Syncer: Call syncer with JUnit file
    Syncer->>ADO: Ensure test assets and publish results
    Syncer->>ADO: Create/update failure tasks with links
    ADO-->>Dashboard: Surface run status, tasks, coverage
    Dashboard-->>Exec: Evidence of tested scenarios and open work
```

- Intent: Illustrate how leaders see coverage and open work in one place.
- Benefits: Provides release confidence with traceable evidence; reduces back-and-forth between engineering and stakeholders.

## Failure Triage Flow

```mermaid
sequenceDiagram
    participant Pipeline as CI Pipeline
    participant Syncer as Azure Test Syncer
    participant Tasks as ADO Tasks/Boards
    participant Dev as Engineer

    Pipeline->>Pipeline: Run tests → detect failures
    Pipeline->>Syncer: Provide JUnit XML
    Syncer->>Tasks: Create/append Task per failed test with run links
    Syncer-->>Pipeline: Output created task IDs
    Dev->>Tasks: Open task, review failure context
    Dev->>Pipeline: Rerun tests after fix
    Pipeline-->>Tasks: Task auto-closed or updated (future extension)
```

- Intent: Show how failures become actionable tasks for engineers.
- Benefits: Faster triage with links to runs; avoids lost failures and speeds revalidation after fixes.

## Audit/Compliance Evidence

```mermaid
sequenceDiagram
    participant Auditor as Auditor/QA
    participant ADO as Azure DevOps (Plans/Runs)
    participant Pipeline as CI Pipeline
    participant Syncer as Azure Test Syncer

    Auditor->>ADO: Request proof of test coverage for release
    Pipeline->>Pipeline: Execute tests, produce JUnit XML
    Pipeline->>Syncer: Trigger sync with release/build number
    Syncer->>ADO: Publish results against plans/suites (when enabled)
    Syncer->>ADO: Link failures to tasks with build/run context
    ADO-->>Auditor: Provide runs, linked tasks, and traceability
```

- Intent: Demonstrate how to generate auditable test evidence per release.
- Benefits: Easy proof of coverage and defect handling for audits without manual report building.

## Ownership Routing (Teams/Services)

```mermaid
sequenceDiagram
    participant Pipeline as CI Pipeline
    participant Syncer as Azure Test Syncer
    participant ADO as Azure DevOps Boards
    participant TeamA as Service Team A
    participant TeamB as Service Team B

    Pipeline->>Pipeline: Run tests -> produce JUnit XML with service tags
    Pipeline->>Syncer: Call syncer with JUnit file
    Syncer->>Syncer: Parse failures, derive owning team from tags/naming
    Syncer->>ADO: Create/update Task and set area path/tag for owning team
    ADO-->>TeamA: Task shows in Team A backlog when tagged for A
    ADO-->>TeamB: Task shows in Team B backlog when tagged for B
    TeamA->>ADO: Update/close Task after fix
    TeamA->>Pipeline: Rerun pipeline to verify fix
    TeamB->>ADO: Update/close Task after fix
    TeamB->>Pipeline: Rerun pipeline to verify fix
```

- Intent: Show how failures are routed to the right team automatically.
- Benefits: Reduces triage overhead, improves accountability, and shortens mean time to resolution by sending work to the right backlog.

## Other Business Use Cases

- Release gating / quality bar  
  - Intent: Gate releases on test pass rates, coverage, and absence of critical open tasks.  
  - Benefits: Prevents risky deployments and enforces quality standards before shipping.

- Hotfix regression check  
  - Intent: Run targeted suites for hotfix branches and ensure failures create/close Tasks tied to the hotfix work item.  
  - Benefits: Minimises blast radius by validating only impacted areas and keeping remediation work traceable.

- UAT sign-off  
  - Intent: Capture UAT outcomes (manual or automated) and link them to release/change tickets with tasks for blockers.  
  - Benefits: Provides PMs and stakeholders a clear sign-off trail with actionable follow-ups.

- SLO/SLA reporting  
  - Intent: Run nightly/periodic suites on critical user journeys and surface trends plus failure tasks for ops/CS leadership.  
  - Benefits: Improves reliability accountability and visibility into customer-impacting regressions.
