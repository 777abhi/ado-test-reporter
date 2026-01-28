import { IGherkinStepConverter } from "./interfaces/IGherkinStepConverter";
import { ParsedStep } from "./interfaces/IParsedScenario";
import { IAdoStep } from "./interfaces/IAdoStep";

export class GherkinStepConverter implements IGherkinStepConverter {
    public convert(gherkinSteps: ParsedStep[]): IAdoStep[] {
        const adoSteps: IAdoStep[] = [];
        let currentStep: IAdoStep | null = null;

        for (const step of gherkinSteps) {
            const keyword = step.keyword.trim();
            const text = step.text;

            const isThen = keyword === 'Then';
            const isContinuation = keyword === 'And' || keyword === 'But' || keyword === '*';

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
