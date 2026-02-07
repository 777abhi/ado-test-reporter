## 2026-02-01 - WIQL Injection
**Vulnerability:** WIQL Injection found in `testCaseService.ts` where `testName` from JUnit XML was interpolated directly into a query.
**Learning:** `azure-devops-node-api`'s `queryByWiql` does not auto-sanitize inputs. Standard SQL-style escaping (doubling single quotes) is effective for WIQL.
**Prevention:** Use `src/utils/WiqlUtils.ts` -> `escapeWiqlString()` for any dynamic values in WIQL queries.

## 2026-10-24 - Stored XSS in Work Item Description
**Vulnerability:** Failure messages from JUnit XML were embedded directly into HTML descriptions of Azure DevOps Work Items. Malicious test names or error messages could execute scripts.
**Learning:** Azure DevOps API does not sanitize HTML in `System.Description` or `ReproSteps` fields. We must treat all upstream data (test results) as untrusted.
**Prevention:** Use `src/utils/XmlUtils.ts` -> `escapeXml()` for any user-controlled string before embedding it in HTML fields.

## 2026-10-25 - Stored XSS in Work Item History
**Vulnerability:** `System.History` field in Azure DevOps Work Items supports HTML, but test failure comments were added without sanitization in `FailureTaskService.ts`.
**Learning:** Even "history" or "comment" fields in ADO are rich-text/HTML enabled. Appending unescaped strings (like error messages) allows Stored XSS.
**Prevention:** Always use `escapeXml()` for any dynamic content being added to `System.History`, and wrap in appropriate HTML tags (e.g., `<p>`, `<pre>`) for formatting.

## 2026-10-26 - Stored XSS in Gherkin Steps
**Vulnerability:** Gherkin step text was interpolated directly into Azure DevOps Test Case "Steps" field (HTML) in `GherkinStepConverter.ts`.
**Learning:** Even content from version-controlled feature files can be a vector for Stored XSS if those files are processed and synced to rich-text fields in external systems.
**Prevention:** Use `src/utils/XmlUtils.ts` -> `escapeXml()` for Gherkin step text and keywords.

## 2026-10-27 - Stored XSS in Excel Import
**Vulnerability:** Excel Import allowed mapping arbitrary columns to HTML-rich fields (e.g., `System.Description`) without sanitization. Malicious Excel files could inject scripts.
**Learning:** Data from file imports must be treated as untrusted user input, especially when mapped to rich-text fields in external systems.
**Prevention:** Explicitly sanitized known HTML fields in `ExcelImportService.ts` using `escapeXml()`.

## 2026-10-28 - Unsanitized Custom HTML Fields in Excel Import
**Vulnerability:** Users could map Excel columns to custom fields (e.g., `Custom.MyHtmlField`) which were not in the hardcoded allowlist for sanitization, bypassing Stored XSS protection.
**Learning:** Hardcoded security allowlists often fail to account for user extensibility (custom fields). Configuration-driven security policies are more robust.
**Prevention:** Added `ADO_HTML_FIELDS` configuration to allow users to specify additional fields that require sanitization.

## 2026-02-07 - CSV Injection (Formula Injection)
**Vulnerability:** Test Case titles or other fields starting with `=`, `+`, or `@` could be interpreted as formulas when exported to Excel.
**Learning:** Tools that sync data to systems (like ADO) which are frequently exported to Excel must treat data as potential CSV/Formula injection vectors.
**Prevention:** Created `src/utils/CsvUtils.ts` -> `sanitizeForCsv()` to prepend `'` to unsafe prefixes. Applied in `TestCaseService` (Title) and `ExcelImportService` (All fields). Excluded `-` to avoid breaking bullet points.
