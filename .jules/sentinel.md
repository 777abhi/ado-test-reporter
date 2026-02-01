## 2026-02-01 - WIQL Injection
**Vulnerability:** WIQL Injection found in `testCaseService.ts` where `testName` from JUnit XML was interpolated directly into a query.
**Learning:** `azure-devops-node-api`'s `queryByWiql` does not auto-sanitize inputs. Standard SQL-style escaping (doubling single quotes) is effective for WIQL.
**Prevention:** Use `src/utils/WiqlUtils.ts` -> `escapeWiqlString()` for any dynamic values in WIQL queries.
