import * as fs from "fs";
import * as xml2js from "xml2js";
import { ITestResultParser, ParsedTestCase } from "./interfaces/ITestResultParser";

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
        const name = tc.$.name;
        const duration = parseFloat(tc.$.time || "0") * 1000; // ms
        const outcome = tc.failure || tc.error ? "Failed" : "Passed";
        const errorMessage =
          tc.failure && tc.failure[0]
            ? JSON.stringify(tc.failure[0])
            : undefined;

        results.push({ name, durationMs: duration, outcome, errorMessage });
      }
    }

    return results;
  }
}
