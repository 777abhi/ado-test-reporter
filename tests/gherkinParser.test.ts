import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { GherkinFeatureParser } from '../src/GherkinFeatureParser';

async function testGherkinLimits() {
    console.log("Starting Gherkin Limit Test...");

    const parser = new GherkinFeatureParser();
    const largeFilePath = path.resolve(__dirname, 'temp_large.feature');
    const smallFilePath = path.resolve(__dirname, 'temp_small.feature');

    // 1. Create a large file (> 50MB)
    // We'll write chunks to avoid memory issues during creation
    const stream = fs.createWriteStream(largeFilePath);
    const chunk = "A".repeat(1024 * 1024); // 1MB
    for (let i = 0; i < 51; i++) {
        stream.write(chunk);
    }
    stream.end();

    await new Promise<void>(resolve => stream.on('finish', () => resolve()));
    console.log(`Created large file: ${largeFilePath} (${fs.statSync(largeFilePath).size} bytes)`);

    try {
        console.log("Attempting to parse large file (Should Fail)...");
        await parser.parse(largeFilePath);
        throw new Error("FAIL: Parser did not throw error for large file.");
    } catch (e: any) {
        if (e.message && e.message.includes("too large")) {
            console.log("✅ PASS: Correctly rejected large file.");
        } else {
            console.error("❌ FAIL: Threw unexpected error:", e);
            throw e;
        }
    } finally {
        if (fs.existsSync(largeFilePath)) fs.unlinkSync(largeFilePath);
    }

    // 2. Create a small valid file
    fs.writeFileSync(smallFilePath, "Feature: Small\n  Scenario: Test\n    Given a step");
    console.log(`Created small file: ${smallFilePath}`);

    try {
        console.log("Attempting to parse small file (Should Succeed)...");
        const scenarios = await parser.parse(smallFilePath);
        if (scenarios.length > 0 && scenarios[0].name === 'Test') {
            console.log("✅ PASS: Successfully parsed small file.");
        } else {
            throw new Error("FAIL: Parsed but result was unexpected.");
        }
    } catch (e) {
        console.error("❌ FAIL: Failed to parse small file:", e);
        throw e;
    } finally {
        if (fs.existsSync(smallFilePath)) fs.unlinkSync(smallFilePath);
    }
}

// Execute if run directly
if (require.main === module) {
    testGherkinLimits().catch((err) => {
        console.error("Test execution failed:", err);
        process.exit(1);
    });
}
