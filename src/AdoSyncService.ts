import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import { WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { IAdoSyncService } from "./interfaces/IAdoSyncService";
import { ParsedScenario, ParsedStep } from "./interfaces/IParsedScenario";

interface AdoStep {
    action: string;
    expected: string;
}

export class AdoSyncService implements IAdoSyncService {
    private witApi: IWorkItemTrackingApi;
    private project: string;

    constructor(witApi: IWorkItemTrackingApi, project: string) {
        this.witApi = witApi;
        this.project = project;
    }

    public async updateTestCase(scenario: ParsedScenario): Promise<void> {
        if (!scenario.tcId) {
            console.warn(`    WARNING: Scenario '${scenario.name}' has no TC ID. Skipping.`);
            return;
        }

        const id = scenario.tcId;

        try {
            // Check if exists
            let existingRelations: string[] = [];
            try {
                // Fetch with relations to check existing links
                const item = await this.witApi.getWorkItem(id, undefined, undefined, WorkItemExpand.Relations);
                if (!item) {
                     console.warn(`    WARNING: Test Case ${id} not found (getWorkItem returned null). Skipping.`);
                     return;
                }
                if (item.relations) {
                    existingRelations = item.relations.map(r => r.url).filter(u => !!u) as string[];
                }
            } catch (err: any) {
                if (err.statusCode === 404 || err.status === 404 || (err.message && err.message.includes('404'))) {
                    console.warn(`    WARNING: Test Case ${id} does not exist in ADO (404). Skipping.`);
                    return;
                }
                throw err;
            }

            const adoSteps = this.convertStepsToAdoFormat(scenario.steps);
            const tagsToSync = scenario.tags.filter(t => !t.startsWith('@TC_'));

            console.log(`  Found Scenario: ${scenario.name} -> ID: ${id} [Tags: ${tagsToSync.join(', ')}]`);

            // Build XML
            let stepsXml = '<steps id="0" last="' + adoSteps.length + '">';
            adoSteps.forEach((step, index) => {
                const stepId = index + 1;
                stepsXml += `
<step id="${stepId}" type="ActionStep">
    <parameterizedString isformatted="true">${this.escapeXml(step.action)}</parameterizedString>
    <parameterizedString isformatted="true">${this.escapeXml(step.expected)}</parameterizedString>
    <description/>
</step>`;
            });
            stepsXml += '</steps>';

            const description = `
                <strong>Feature:</strong> ${this.escapeXml(scenario.featureName)}<br/>
                ${scenario.featureDescription ? `<p>${this.escapeXml(scenario.featureDescription)}</p>` : ''}
                <br/>
                <strong>Scenario:</strong> ${this.escapeXml(scenario.name)}<br/>
                ${scenario.description ? `<p>${this.escapeXml(scenario.description)}</p>` : ''}
            `;

            const patchDocument: any[] = [
                {
                    op: "add",
                    path: "/fields/Microsoft.VSTS.TCM.Steps",
                    value: stepsXml
                },
                {
                    op: "add",
                    path: "/fields/System.Tags",
                    value: tagsToSync.join("; ")
                },
                {
                    op: "add",
                    path: "/fields/System.Description",
                    value: description
                }
            ];

            // Auto-link requirements from tags (e.g. @Story_123, @AB#123)
            const reqRegex = /@(?:Story|Requirement|Bug|Task|UserStory|Feature|Epic|Issue|AB#?)_?(\d+)/i;
            const reqTags = scenario.tags.filter(t => reqRegex.test(t));

            for (const tag of reqTags) {
                const match = tag.match(reqRegex);
                if (match) {
                    const reqId = parseInt(match[1], 10);
                    try {
                        const reqItem = await this.witApi.getWorkItem(reqId);
                        if (reqItem && reqItem.url && !existingRelations.includes(reqItem.url)) {
                             patchDocument.push({
                                op: "add",
                                path: "/relations/-",
                                value: {
                                    rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
                                    url: reqItem.url,
                                    attributes: { comment: "Auto-linked from Gherkin Tag" }
                                }
                            });
                            console.log(`    Planning to link TC ${id} to Requirement ${reqId}`);
                            existingRelations.push(reqItem.url); // prevent duplicate in this batch
                        }
                    } catch (e) {
                        console.warn(`    WARNING: Could not link tag ${tag} to a work item: ${(e as Error).message}`);
                    }
                }
            }

            // @ts-ignore - updateWorkItem signature might vary, matching original code usage
            await this.witApi.updateWorkItem(null, patchDocument, id);
            console.log(`    SUCCESS: Updated TC ${id} steps, tags, fields, and links.`);

        } catch (error) {
            console.error(`    FAILED to update TC ${id}:`, error);
        }
    }

    private convertStepsToAdoFormat(gherkinSteps: ParsedStep[]): AdoStep[] {
        const adoSteps: AdoStep[] = [];
        let currentStep: AdoStep | null = null;

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

    private escapeXml(unsafe: string): string {
        return unsafe.replace(/[<>&'"]/g, function (c) {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
            }
            return c;
        });
    }
}
