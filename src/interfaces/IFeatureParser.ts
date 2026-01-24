import { ParsedScenario } from "./IParsedScenario";

export interface IFeatureParser {
    parse(pattern: string): Promise<ParsedScenario[]>;
}
