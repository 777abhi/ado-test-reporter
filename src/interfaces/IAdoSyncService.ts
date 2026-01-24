import { ParsedScenario } from "./IParsedScenario";

export interface IAdoSyncService {
    updateTestCase(scenario: ParsedScenario): Promise<void>;
}
