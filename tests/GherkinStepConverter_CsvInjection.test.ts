import { GherkinStepConverter } from "../src/GherkinStepConverter";
import { ParsedStep } from "../src/interfaces/IParsedScenario";

describe("GherkinStepConverter CSV Injection Sanitization", () => {
  it("should sanitize formula injection prefixes in Gherkin steps while preserving bullet points", () => {
    const converter = new GherkinStepConverter();

    const maliciousSteps: ParsedStep[] = [
      { keyword: "Given", text: "=cmd| /C calc" },
      { keyword: "When", text: "+cmd| /C calc" },
      { keyword: "Then", text: "@cmd| /C calc" },
      { keyword: "And", text: "-cmd| /C calc" },
      { keyword: "And", text: "- Bullet point" },
    ];

    const result = converter.convert(maliciousSteps);

    // 1. Given step with '='
    const givenStep = result[0];
    expect(givenStep.action).toContain("Given &apos;=cmd| /C calc");

    // 2. Hyphen step without space '-cmd'
    const whenThenStep = result[1];
    expect(whenThenStep).toBeDefined();
    expect(whenThenStep.expected).toContain("And &apos;-cmd| /C calc");

    // 3. Bullet point step '- Bullet point'
    expect(whenThenStep.expected).toContain("And - Bullet point");
  });
});
