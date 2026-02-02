## 2026-02-01 - WIQL Injection
**Vulnerability:** WIQL Injection found in `testCaseService.ts` where `testName` from JUnit XML was interpolated directly into a query.
**Learning:** `azure-devops-node-api`'s `queryByWiql` does not auto-sanitize inputs. Standard SQL-style escaping (doubling single quotes) is effective for WIQL.
**Prevention:** Use `src/utils/WiqlUtils.ts` -> `escapeWiqlString()` for any dynamic values in WIQL queries.

## 2026-10-24 - Stored XSS in Work Item Description
**Vulnerability:** Failure messages from JUnit XML were embedded directly into HTML descriptions of Azure DevOps Work Items. Malicious test names or error messages could execute scripts.
**Learning:** Azure DevOps API does not sanitize HTML in `System.Description` or `ReproSteps` fields. We must treat all upstream data (test results) as untrusted.
**Prevention:** Use `src/utils/XmlUtils.ts` -> `escapeXml()` for any user-controlled string before embedding it in HTML fields.
