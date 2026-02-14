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

## 2026-10-29 - CSV Injection in System.Tags
**Vulnerability:** `System.Tags` field in Test Cases was not sanitized for CSV/Formula Injection, allowing malicious tags (e.g. from Gherkin feature files) to execute formulas when exported to Excel.
**Learning:** `System.Tags` is a frequently exported field and should be treated as untrusted plain text. Even if tags are semicolon-separated, the first tag can trigger a formula.
**Prevention:** Applied `sanitizeForCsv()` to `System.Tags` in `TestCaseService.ts`.

## 2026-10-30 - Incomplete CSV Injection Sanitization (Hyphen)
**Vulnerability:** The hyphen (`-`) character was excluded from CSV sanitization to preserve markdown bullet points, leaving a vector for formula injection (e.g. `-1+1`, `-cmd|...`).
**Learning:** Security exemptions for formatting must be narrowly scoped. A blanket exclusion of a dangerous character is risky. We can be specific: only allow `-` if followed by a space (standard bullet point syntax).
**Prevention:** Updated `sanitizeForCsv()` to escape `-` unless it is followed by a space.

## 2026-02-10 - Weak Hashing Algorithm (MD5)
**Vulnerability:** Error grouping logic in `FailureTaskService.ts` used MD5, which is considered cryptographically weak and prone to collisions.
**Learning:** While the primary risk here is collision-based reporting issues rather than data leakage, using modern hashing algorithms (SHA-256) is a standard security best practice to prevent potential collision attacks.
**Prevention:** Upgraded `generateErrorHash` to use `sha256`. Note: This changes the hash length from 32 to 64 characters, causing new tasks to be created for existing errors (one-time migration).

## 2026-10-31 - Unbounded Input Length (DoS)
**Vulnerability:** `System.Title` in Test Cases was not checked for length limits. Extremely long test names (>255 chars) caused API errors, crashing the sync process and denying service.
**Learning:** External APIs often have strict input limits. Relying on them to handle over-length inputs gracefully is risky. Proactive truncation/validation ensures pipeline stability.
**Prevention:** Implemented `ensureTitleLength` in `TestCaseService` to truncate titles to 255 chars, appending a SHA-256 hash to preserve uniqueness.

## 2026-11-01 - XML External Entity (XXE) and DoS Protection
**Vulnerability:** `JUnitParser` read arbitrary file paths into memory without size limits or type checks. This could lead to Denial of Service (DoS) via large files (OOM) or reading from blocking devices (e.g. `/dev/zero`).
**Learning:** File processing logic must always validate inputs (file type and size) *before* reading content into memory, especially in Node.js where large buffers can crash the process.
**Prevention:** Implemented strict file size limit (50MB) and `isFile()` check in `junitParser.ts` before reading.

## 2026-02-14 - Path Traversal in JUnit Attachments
**Vulnerability:** `FailureTaskService` uploaded files specified in JUnit XML attachments (`[[ATTACHMENT|path]]`) without validating the path. This allowed malicious tests or modified XML to exfiltrate arbitrary files from the build agent (e.g., `/etc/passwd`, secrets).
**Learning:** Never trust file paths provided in external input (like test results). Always treat them as untrusted and validate that they resolve to a safe directory (e.g., CWD).
**Prevention:** Implemented path validation in `FailureTaskService.ts` using `path.resolve` to ensure all attachments are contained within the current working directory.
