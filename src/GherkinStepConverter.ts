import { IGherkinStepConverter } from "./interfaces/IGherkinStepConverter";
import { ParsedStep } from "./interfaces/IParsedScenario";
import { IAdoStep } from "./interfaces/IAdoStep";
import { escapeXml } from "./utils/XmlUtils";
import { sanitizeForCsv } from "./utils/CsvUtils";
import { SecretRedactor } from "./utils/SecretRedactor";

export class GherkinStepConverter implements IGherkinStepConverter {
    public convert(gherkinSteps: ParsedStep[]): IAdoStep[] {
        const adoSteps: IAdoStep[] = [];
        let currentStep: IAdoStep | null = null;

        for (const step of gherkinSteps) {
            // Sentinel: Sanitize Gherkin steps to prevent CSV/Formula Injection
            // We trim first, then sanitize for CSV (which adds ' if unsafe), then escape XML.
            const rawKeyword = sanitizeForCsv(step.keyword.trim());
            const keyword = escapeXml(rawKeyword);

            // Also sanitize the step text and redact secrets
            const redactedText = SecretRedactor.redact(step.text);
            const text = escapeXml(sanitizeForCsv(redactedText));

            // Note: rawKeyword should be safe "Given", "When", "Then" usually, so sanitizeForCsv won't touch it unless malicious.
            const isThen = rawKeyword === 'Then';
            const isContinuation = rawKeyword === 'And' || rawKeyword === 'But' || rawKeyword === '*';

            if (isThen) {
                if (currentStep) {
                     currentStep.expected = currentStep.expected ? `${currentStep.expected}<br/>${keyword} ${text}` : `${keyword} ${text}`;
                } else {
                     currentStep = { action: "Check Condition", expected: `${keyword} ${text}` };
                     adoSteps.push(currentStep);
                }
            } else if (isContinuation) {
                if (currentStep) {
                    if (currentStep.expected) {
                        currentStep.expected += `<br/>${keyword} ${text}`;
                    } else {
                        currentStep.action += `<br/>${keyword} ${text}`;
                    }
                } else {
                     currentStep = { action: `${keyword} ${text}`, expected: "" };
                     adoSteps.push(currentStep);
                }
            } else {
                currentStep = { action: `${keyword} ${text}`, expected: "" };
                adoSteps.push(currentStep);
            }
        }
        return adoSteps;
    }
}
