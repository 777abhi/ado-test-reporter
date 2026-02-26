import * as assert from 'assert';
import { SecretRedactor } from '../src/utils/SecretRedactor';

function testRedaction() {
    console.log("Running SecretRedactor Tests...");

    const testCases = [
        {
            name: "GitHub Token",
            input: "My token is ghp_123456789012345678901234567890123456.",
            expected: "My token is ***REDACTED***."
        },
        {
            name: "Bearer Token",
            input: "Authorization: Bearer abcdef123456",
            expected: "Authorization: ***REDACTED***"
        },
        {
            name: "Generic Password with =",
            input: "password = \"supersecret\"",
            expected: "password=***REDACTED***"
        },
        {
            name: "Generic Secret with :",
            input: "client_secret: mysecretvalue",
            expected: "client_secret=***REDACTED***"
        },
        {
            name: "Generic API Key",
            input: "api_key='12345'",
            expected: "api_key=***REDACTED***"
        },
        {
            name: "No Secrets",
            input: "This is a safe string.",
            expected: "This is a safe string."
        },
        {
            name: "False Positive Check (token)",
            input: "Unexpected token found.", // 'token' is not in the list anymore, generic pattern handles 'access_token' etc.
            expected: "Unexpected token found."
        },
        {
            name: "False Positive Check (key)",
            input: "The key feature is missing.",
            expected: "The key feature is missing."
        },
        {
            name: "AWS Key",
            input: "Key: AKIAABCDEFGHIJKLMNOP",
            expected: "Key: ***REDACTED***"
        }
    ];

    let passed = 0;
    let failed = 0;

    for (const tc of testCases) {
        try {
            const actual = SecretRedactor.redact(tc.input);
            assert.strictEqual(actual, tc.expected, `Test Case "${tc.name}" failed`);
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

testRedaction();
