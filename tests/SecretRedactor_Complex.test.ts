import * as assert from 'assert';
import { SecretRedactor } from '../src/utils/SecretRedactor';

function runTests() {
    console.log("Running Complex SecretRedactor Tests...");

    const testCases = [
        // 1. Double Quotes with spaces
        {
            name: "Double quotes with spaces",
            input: 'password = "super secret value"',
            // Updated expectation: we now preserve quotes if present
            expected: 'password="***REDACTED***"'
        },
        // 2. Single Quotes with spaces
        {
            name: "Single quotes with spaces",
            input: "client_secret: 'my secret key'",
            // Updated expectation: we now preserve quotes if present and use the found separator
            expected: "client_secret:'***REDACTED***'"
        },
        // 3. Unquoted (existing behavior check)
        {
            name: "Unquoted simple value",
            input: "api_key=12345",
            // Unquoted -> no quotes in output
            expected: "api_key=***REDACTED***"
        },
        // 4. Mixed quotes and spaces
        {
            name: "JSON style",
            input: '"access_token": "abc 123 xyz"',
            // JSON style should look like JSON
            expected: '"access_token": "***REDACTED***"'
        },
        // 5. Multiple pairs in one line
        {
            name: "Multiple pairs",
            input: 'id=123 password="secure" token=\'secret\'',
            // Preserving quotes
            expected: 'id=123 password="***REDACTED***" token=\'***REDACTED***\''
        },
        // 6. False positive check (should not consume too much)
        {
            name: "Sentence looking like key value",
            input: "The secret is not here.",
            expected: "The secret is not here."
        }
    ];

    let passed = 0;
    let failed = 0;

    for (const tc of testCases) {
        try {
            const actual = SecretRedactor.redact(tc.input);
            assert.strictEqual(actual, tc.expected);
            console.log(`✅ ${tc.name}`);
            passed++;
        } catch (e) {
            console.error(`❌ ${tc.name} FAILED:`);
            console.error(`   Input:    ${tc.input}`);
            console.error(`   Expected: ${tc.expected}`);
            console.error(`   Actual:   ${SecretRedactor.redact(tc.input)}`);
            failed++;
        }
    }

    console.log(`\nResults: ${passed} Passed, ${failed} Failed.`);
    if (failed > 0) process.exit(1);
}

runTests();
