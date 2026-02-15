import * as fs from 'fs';
import * as assert from 'assert';
import { JUnitParser } from '../src/junitParser';
import * as path from 'path';

async function testLimits() {
    const parser = new JUnitParser();
    const largeError = "A".repeat(10000); // 10KB
    const longAttachment = "B".repeat(5000); // 5KB

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

    const filePath = path.resolve(__dirname, 'temp_large_junit.xml');
    fs.writeFileSync(filePath, xml);

    try {
        console.log("Parsing XML...");
        const results = await parser.parse(filePath);
        const errorCase = results.find(r => r.name === 'TestLimitError');
        const attachCase = results.find(r => r.name === 'TestLimitAttachment');

        console.log(`Error Message Length: ${errorCase?.errorMessage?.length}`);
        console.log(`Attachments Found: ${attachCase?.attachments?.length}`);

        // Verification logic
        if (!errorCase?.errorMessage) {
            throw new Error("FAIL: Error message not found.");
        }

        if (errorCase.errorMessage.length > 4096) {
             throw new Error("FAIL (Current Behavior): Error message was NOT truncated.");
        }
        console.log("✅ PASS: Error message truncated.");
        assert.ok(errorCase.errorMessage.length <= 4096, "Error message should be <= 4096 chars");

        if (attachCase?.attachments && attachCase.attachments.length > 0) {
             const firstAttach = attachCase.attachments[0];
             if (firstAttach.length > 4096) {
                 throw new Error("FAIL (Current Behavior): Long attachment was matched.");
             }
             console.log("✅ PASS: Long attachment ignored/truncated.");
        } else {
             console.log("✅ PASS: Long attachment ignored (no match).");
        }

    } catch (e) {
        console.error("❌ Test Failed:", e);
        throw e;
    } finally {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
}

// Execute if run directly
if (require.main === module) {
    testLimits().catch(() => process.exit(1));
}
