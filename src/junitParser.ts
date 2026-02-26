import * as fs from "fs";
import * as xml2js from "xml2js";
import { ITestResultParser, ParsedTestCase } from "./interfaces/ITestResultParser";
import { SecretRedactor } from "./utils/SecretRedactor";

export class JUnitParser implements ITestResultParser {
  async parse(filePath: string): Promise<ParsedTestCase[]> {
    const stats = fs.statSync(filePath);

    if (!stats.isFile()) {
      throw new Error(`JUnit XML path is not a file: ${filePath}`);
    }

    const MAX_XML_SIZE = 50 * 1024 * 1024; // 50MB
    if (stats.size > MAX_XML_SIZE) {
      throw new Error(
        `JUnit XML file is too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Max allowed: 50MB.`
      );
    }

    const xmlContent = fs.readFileSync(filePath, "utf-8");
    const parser = new xml2js.Parser();
    const parsedXml = await parser.parseStringPromise(xmlContent);

    const testSuites = parsedXml.testsuites
      ? parsedXml.testsuites.testsuite
      : parsedXml.testsuite
        ? [parsedXml.testsuite]
        : [];

    const results: ParsedTestCase[] = [];

    for (const suite of testSuites) {
      const suiteCases = suite.testcase || [];
      for (const tc of suiteCases) {
        // Sentinel: Redact test name to prevent secret leakage
        const name = SecretRedactor.redact(tc.$.name);
        const duration = parseFloat(tc.$.time || "0") * 1000; // ms
        const outcome = tc.failure || tc.error ? "Failed" : "Passed";
        let errorMessage: string | undefined;
        if (tc.failure && tc.failure[0]) {
            const fail = tc.failure[0];
            // Sentinel: Extract meaningful error message and truncate to prevent DoS/Storage issues
            let msg = typeof fail === 'string' ? fail : (fail._ || fail.$?.message || JSON.stringify(fail));
            const MAX_MSG_LEN = 4096;
            if (msg && msg.length > MAX_MSG_LEN) {
                const suffix = '... (truncated)';
                msg = msg.substring(0, MAX_MSG_LEN - suffix.length) + suffix;
            }
            // Sentinel: Redact error message to prevent secret leakage
            errorMessage = SecretRedactor.redact(msg);
        }

        const attachments: string[] = [];
        const contentSources = [
          ...(tc['system-out'] || []),
          ...(tc['system-err'] || [])
        ];

        // Regex to find [[ATTACHMENT|path/to/file]] - Limited to 4KB to prevent DoS
        const attachmentRegex = /\[\[ATTACHMENT\|([^\]]{1,4096})\]\]/g;

        for (const source of contentSources) {
          if (typeof source === 'string') {
             let match;
             while ((match = attachmentRegex.exec(source)) !== null) {
               attachments.push(match[1].trim());
             }
          }
        }

        results.push({ name, durationMs: duration, outcome, errorMessage, attachments });
      }
    }

    return results;
  }
}
