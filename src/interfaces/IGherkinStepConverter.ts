import { ParsedStep } from "./IParsedScenario";
import { IAdoStep } from "./IAdoStep";

export interface IGherkinStepConverter {
    convert(gherkinSteps: ParsedStep[]): IAdoStep[];
}
