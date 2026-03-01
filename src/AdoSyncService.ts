import { IAdoSyncService } from "./interfaces/IAdoSyncService";
import { ParsedScenario } from "./interfaces/IParsedScenario";
import { IGherkinStepConverter } from "./interfaces/IGherkinStepConverter";
import { ITestCaseService } from "./interfaces/ITestCaseService";
import { escapeXml } from "./utils/XmlUtils";
import { SecretRedactor } from "./utils/SecretRedactor";

export class AdoSyncService implements IAdoSyncService {
    private testCaseService: ITestCaseService;
    private stepConverter: IGherkinStepConverter;

    constructor(testCaseService: ITestCaseService, stepConverter: IGherkinStepConverter) {
        this.testCaseService = testCaseService;
        this.stepConverter = stepConverter;
    }

    public async updateTestCase(scenario: ParsedScenario): Promise<void> {
        if (!scenario.tcId) {
            console.warn(`    WARNING: Scenario '${scenario.name}' has no TC ID. Skipping.`);
            return;
        }

        const id = scenario.tcId;

        try {
            // Check if exists
            const existing = await this.testCaseService.getTestCase(id);
            if (!existing) {
                console.warn(`    WARNING: Test Case ${id} not found or inaccessible. Skipping.`);
                return;
            }

            const adoSteps = this.stepConverter.convert(scenario.steps);
            const tagsToSync = scenario.tags.filter(t => !t.startsWith('@TC_'));

            console.log(`  Found Scenario: ${scenario.name} -> ID: ${id} [Tags: ${tagsToSync.join(', ')}]`);

            // Build XML
            let stepsXml = '<steps id="0" last="' + adoSteps.length + '">';
            adoSteps.forEach((step, index) => {
                const stepId = index + 1;
                stepsXml += `
<step id="${stepId}" type="ActionStep">
    <parameterizedString isformatted="true">${escapeXml(step.action)}</parameterizedString>
    <parameterizedString isformatted="true">${escapeXml(step.expected)}</parameterizedString>
    <description/>
</step>`;
            });
            stepsXml += '</steps>';

            const description = `
                <strong>Feature:</strong> ${escapeXml(scenario.featureName)}<br/>
                ${scenario.featureDescription ? `<p>${escapeXml(scenario.featureDescription)}</p>` : ''}
                <br/>
                <strong>Scenario:</strong> ${escapeXml(scenario.name)}<br/>
                ${scenario.description ? `<p>${escapeXml(scenario.description)}</p>` : ''}
            `;

            const fields: Record<string, any> = {
                "Microsoft.VSTS.TCM.Steps": stepsXml,
                "System.Tags": tagsToSync.join("; "),
                "System.Description": description
            };

            await this.testCaseService.updateTestCase(id, fields);

            // Auto-link requirements from tags (e.g. @Story_123, @AB#123)
            const reqRegex = /@(?:Story|Requirement|Bug|Task|UserStory|Feature|Epic|Issue|AB#?)_?(\d+)/i;
            const reqTags = scenario.tags.filter(t => reqRegex.test(t));
            const reqIds: number[] = [];

            for (const tag of reqTags) {
                const match = tag.match(reqRegex);
                if (match) {
                    const reqId = parseInt(match[1], 10);
                    if (!isNaN(reqId)) {
                        reqIds.push(reqId);
                    }
                }
            }

            if (reqIds.length > 0) {
                console.log(`    Planning to link TC ${id} to Requirements: ${reqIds.join(', ')}`);
                await this.testCaseService.linkRequirementsById(id, reqIds);
            }

            console.log(`    SUCCESS: Updated TC ${id} steps, tags, fields, and links.`);

        } catch (error) {
            const errorStr = typeof error === 'string' ? error : ((error as Error).message || JSON.stringify(error));
            console.error(SecretRedactor.redact(`    FAILED to update TC ${id}:`), SecretRedactor.redact(errorStr));
        }
    }
}
