import * as assert from 'assert';
import { GherkinStepConverter } from '../src/GherkinStepConverter';
import { ParsedStep } from '../src/interfaces/IParsedScenario';

async function testGherkinStepCsvInjection() {
    console.log("Starting Gherkin Step CSV Injection Test...");

    const converter = new GherkinStepConverter();

    const maliciousSteps: ParsedStep[] = [
        { keyword: 'Given', text: '=cmd| /C calc' }, // Step 1 Action
        { keyword: 'When', text: '+cmd| /C calc' },  // Step 2 Action
        { keyword: 'Then', text: '@cmd| /C calc' },  // Step 2 Expected
        { keyword: 'And', text: '-cmd| /C calc' },   // Step 2 Expected (Continuation)
        { keyword: 'And', text: '- Bullet point' }   // Step 2 Expected (Continuation)
    ];

    const result = converter.convert(maliciousSteps);

    // 1. Check 'Given' step (Formula Injection with =)
    const givenStep = result[0];
    const expectedGiven = "Given &apos;=cmd| /C calc";

    if (givenStep.action.includes(expectedGiven)) {
        console.log("✅ PASS: Given step is sanitized.");
    } else {
        console.error(`❌ FAIL: Given step is NOT sanitized. Got: ${givenStep.action}`);
        throw new Error("FAIL: CSV Injection vulnerability detected in Given step.");
    }

    // 2. Check Hyphen step (It's an 'And' following 'Then', so it's in the Expected Result of the second step)
    const whenThenStep = result[1]; // The 'When' step which absorbed 'Then' and 'And's

    if (!whenThenStep) throw new Error("FAIL: Second step (When/Then) not found");

    const expectedHyphen = "And &apos;-cmd| /C calc";

    // Note: sanitizeForCsv escapes '-' if not followed by space.
    // So '-cmd' -> "'-cmd" -> "&apos;-cmd"

    if (whenThenStep.expected.includes(expectedHyphen)) {
        console.log("✅ PASS: Hyphen step is sanitized (in Expected Result).");
    } else {
        console.error(`❌ FAIL: Hyphen step is NOT sanitized. Got Expected: ${whenThenStep.expected}`);
        throw new Error("FAIL: CSV Injection vulnerability detected in Hyphen step.");
    }

    // 3. Check Bullet point step
    const expectedBullet = "And - Bullet point";

    // Note: sanitizeForCsv allows '-' if followed by space.
    // So '- Bullet' -> '- Bullet' -> "- Bullet" (no special XML chars besides space/hyphen which are safe)

    if (whenThenStep.expected.includes(expectedBullet)) {
         console.log("✅ PASS: Bullet point is preserved correctly (not sanitized).");
    } else {
         console.error(`❌ FAIL: Bullet point was incorrectly sanitized. Got Expected: ${whenThenStep.expected}`);
         throw new Error("FAIL: Bullet point incorrectly sanitized.");
    }
}

if (require.main === module) {
    testGherkinStepCsvInjection().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
