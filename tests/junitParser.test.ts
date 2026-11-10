import * as fs from "fs";
import * as path from "path";
import { JUnitParser } from "../src/junitParser";

describe("JUnitParser Limits & Truncation", () => {
  const filePath = path.resolve(__dirname, "temp_large_junit.xml");

  afterEach(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it("should truncate oversized error messages and ignore oversized attachments", async () => {
    const parser = new JUnitParser();
    const largeError = "A".repeat(10000);
    const longAttachment = "B".repeat(5000);

    const xml = `
<testsuites>
  <testsuite name="Suite1">
    <testcase name="TestLimitError">
      <failure message="${largeError}">${largeError}</failure>
    </testcase>
    <testcase name="TestLimitAttachment">
      <system-out>[[ATTACHMENT|${longAttachment}]]</system-out>
    </testcase>
  </testsuite>
</testsuites>
`;

    fs.writeFileSync(filePath, xml);

    const results = await parser.parse(filePath);
    const errorCase = results.find((r) => r.name === "TestLimitError");
    const attachCase = results.find((r) => r.name === "TestLimitAttachment");

    expect(errorCase?.errorMessage).toBeDefined();
    expect(errorCase!.errorMessage!.length).toBeLessThanOrEqual(4096);

    if (attachCase?.attachments && attachCase.attachments.length > 0) {
      expect(attachCase.attachments[0].length).toBeLessThanOrEqual(4096);
    } else {
      expect(attachCase?.attachments?.length || 0).toBe(0);
    }
  });
});
