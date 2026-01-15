# ADO Test Reporter

A lightweight service that keeps automated test execution traceable in Azure DevOps. It turns JUnit results into living Test Cases, Plans, Suites, and linked Tasks for failures—so stakeholders always see what shipped, what failed, and where to act.

Why it matters (for stakeholders)

- Proof of coverage: JUnit tests are mapped to Test Cases and attached to Plans/Suites, so coverage is visible in ADO instead of hidden in pipelines.
- Faster triage: Failures auto-create/update Tasks with run links and test case references, giving engineers an actionable to-do list.
- Clean reporting: Results are published against Test Points, avoiding “Other” noise in runs and keeping dashboards trustworthy.
- Fresh runs on demand: Optional auto-generated Plans/Suites per run keep environments isolated for validation or audits.

How it works

- Parse JUnit XML, extract TC IDs (`..._TC123`), and reuse or create Test Cases.
- Ensure the target Test Plan/Suite exists (or auto-generate names) and link only missing Test Cases to avoid duplicates.
- Map results to Test Points, publish the run, and complete it.
- On failures, create or update Tasks with links back to the run and Test Case.

Quick start

1. Install dependencies: `npm install`
2. Configure `.env` (gitignored) from `.env.example` with ADO token, org URL, project.
3. Run locally:

```node
npm start -- \
  --junit-file src/results.xml \
  --plan-name "test-plan-ado-test-reporter" \
  --suite-name "suite-name-ado-test-reporter"
```

- Use `--plan-name auto-generate` / `--suite-name auto-generate` to create fresh plan/suite per run.

Pipeline usage

- See `azure-pipelines.yml`: installs deps and runs `npx ts-node src/index.ts`.
- `CREATE_FAILURE_TASKS` (default true) controls whether Tasks are created for failures.
- `TEST_PLAN_NAME` / `TEST_SUITE_NAME` can be set to `auto-generate` for per-run isolation.

Other Useful links

- [Core Logic](docs/sequence-diagram.md)
- [Screen Shots](https://docs.google.com/presentation/d/1Cdk-6VaNdSHx073H-eCI7MMRfK0EcmA0/edit?usp=sharing&ouid=113003728679286380567&rtpof=true&sd=true)
- [Technical Docs](docs)
