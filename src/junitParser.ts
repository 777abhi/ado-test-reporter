import * as fs from "fs";
import * as xml2js from "xml2js";

export type ParsedTestCase = {
  name: string;
  durationMs: number;
  outcome: "Passed" | "Failed";
  errorMessage?: string;
};

export async function parseJUnit(filePath: string): Promise<ParsedTestCase[]> {
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
