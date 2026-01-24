
import * as glob from 'glob';
import * as fs from 'fs';
import { GherkinStreams } from '@cucumber/gherkin-streams';
import * as messages from '@cucumber/messages';
import * as azdev from 'azure-devops-node-api';
import * as witInterfaces from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config();

/**
 * Interface representing a Test Step to be pushed to ADO
 */
interface AdoStep {
    action: string;
    expected: string;
}

/**
 * Main class to handle synchronization
 */
class FeatureSync {
    private connection: azdev.WebApi;
    private witApi: any; // WorkItemTrackingApi
    private project: string;

    constructor() {
        const orgUrl = process.env.ADO_ORG_URL;
        const token = process.env.ADO_TOKEN;
        this.project = process.env.ADO_PROJECT || '';

        if (!orgUrl || !token) {
            throw new Error("Missing ADO_ORG_URL or ADO_TOKEN in .env");
        }

        const authHandler = azdev.getPersonalAccessTokenHandler(token);
        this.connection = new azdev.WebApi(orgUrl, authHandler);
    }

    public async init() {
        this.witApi = await this.connection.getWorkItemTrackingApi();
    }

    public async run(featuresPattern: string) {
        console.log(`Searching for feature files: ${featuresPattern}`);
        const files = glob.sync(featuresPattern);
        
        if (files.length === 0) {
            console.log("No feature files found.");
            return;
        }

        for (const file of files) {
            await this.processFeatureFile(file);
        }
    }

    private async processFeatureFile(file: string) {
        console.log(`Processing: ${file}`);
        const stream = GherkinStreams.fromPaths([file], {
            newId: messages.IdGenerator.uuid(),
        });

        await new Promise<void>((resolve, reject) => {
            stream.on('data', (envelope: messages.Envelope) => {
                // Check if it's a gherkinDocument
                
                if (envelope.gherkinDocument) {
             
                    const feature = envelope.gherkinDocument.feature;
                    if (!feature) return;

                    // Background steps
                    let backgroundSteps: readonly messages.Step[] = [];
                    // Find background if exists
                    const background = feature.children.find(c => c.background)?.background;
                    if (background) {
                       backgroundSteps = background.steps;
                    }
                    
                    const featureTags = feature.tags ? feature.tags.map(t => t.name) : [];
                    const featureName = feature.name;
                    const featureDescription = feature.description || '';
                    
                    // explicit area path logic: defaults to Project Name. If file is in subdir, append subdir.
                    // e.g. features/retail/cart.feature -> Retail
                    // NOTE: This assumes the Area Path nodes ALREADY EXIST in ADO. If not, it fails.
                    // For safety in this demo, defaulting to Project Root to avoid TF401347.
                    // Enable the below logic only if you are sure Area Paths exist.
                    /*
                    const relativePath = path.relative('features', file);
                    const dirName = path.dirname(relativePath);
                    let areaPath = this.project; 
                    if (dirName && dirName !== '.') {
                         // Replace / with \ for ADO Area Path
                        const subArea = dirName.split(path.sep).join('\\');
                        areaPath = `${this.project}\\${subArea}`;
                    }
                    */
                   const areaPath = this.project;

                    // Iterate Children (Scenarios or Rules)
                    for (const child of feature.children) {
                        if (child.scenario) {
                            this.processScenario(child.scenario, backgroundSteps, featureTags, featureName, featureDescription, areaPath);
                        } else if (child.rule) {
                            // Helper to process Rule children
                            const rule = child.rule;
                            let ruleBackgroundSteps: readonly messages.Step[] = [];
                            const ruleBackground = rule.children.find(c => c.background)?.background;
                            if (ruleBackground) {
                                ruleBackgroundSteps = ruleBackground.steps;
                            }
                            // Combine Feature Background + Rule Background
                            const combinedBackground = [...backgroundSteps, ...ruleBackgroundSteps];
                            
                            const ruleTags = rule.tags ? rule.tags.map(t => t.name) : [];
                            const combinedTags = [...featureTags, ...ruleTags];

                            for (const ruleChild of rule.children) {
                                if (ruleChild.scenario) {
                                    this.processScenario(ruleChild.scenario, combinedBackground, combinedTags, featureName, featureDescription, areaPath);
                                }
                            }
                        }
                    }
                }
            });
            stream.on('end', () => resolve());
            stream.on('error', (err) => reject(err));
        });
    }

    private processScenario(
        scenario: messages.Scenario, 
        backgroundSteps: readonly messages.Step[], 
        inheritedTags: string[] = [],
        featureName: string,
        featureDescription: string,
        areaPath: string
    ) {
        const tcTag = scenario.tags.find(t => t.name.startsWith('@TC_'));
        if (tcTag) {
            const tcId = parseInt(tcTag.name.substring(4));
            
            // Combine tags
            const scenarioTags = scenario.tags ? scenario.tags.map(t => t.name) : [];
            const allTags = Array.from(new Set([...inheritedTags, ...scenarioTags]));
            const tagsToSync = allTags.filter(t => !t.startsWith('@TC_'));

            console.log(`  Found Scenario: ${scenario.name} -> ID: ${tcId} [Tags: ${tagsToSync.join(', ')}]`);
            
            // Combine Background Steps + Scenario Steps
            const allSteps = [...backgroundSteps, ...scenario.steps];
            const adoSteps = this.convertStepsToAdoFormat(allSteps);
            
            // description
            const description = `
                <strong>Feature:</strong> ${this.escapeXml(featureName)}<br/>
                ${featureDescription ? `<p>${this.escapeXml(featureDescription)}</p>` : ''}
                <br/>
                <strong>Scenario:</strong> ${this.escapeXml(scenario.name)}<br/>
                ${scenario.description ? `<p>${this.escapeXml(scenario.description)}</p>` : ''}
            `;

            this.updateAdoTestCase(tcId, adoSteps, tagsToSync, scenario.name, description, areaPath)
                .catch(e => console.error(`    Error updating TC ${tcId}:`, e));
        }
    }


    private convertStepsToAdoFormat(gherkinSteps: messages.Step[]): AdoStep[] {
        const adoSteps: AdoStep[] = [];
        let currentStep: AdoStep | null = null;

        for (const step of gherkinSteps) {
            const keyword = step.keyword.trim(); // Given, When, Then
            const text = step.text;

            // Simplified mapping logic:
            // "Then" implies Expected Result
            // All others (Given, When, And, But) are Actions, UNLESS following a 'Then' (And check result...)
            
            // NOTE: Robust logic is hard purely on keyword.
            // Convention: 
            // - If keyword is THEN -> Start adding to 'expected' of CURRENT step (or create new step if needed but usually follows action)
            // - If keyword is GIVEN/WHEN -> New Action step
            // - AND/BUT -> Append to whomever is active (Action or Expected)
            
            const isThen = keyword === 'Then';
            const isContinuation = keyword === 'And' || keyword === 'But' || keyword === '*';
            
            if (isThen) {
                // If we have a current step, append to its expected result
                if (currentStep) {
                     currentStep.expected = currentStep.expected ? `${currentStep.expected}<br/>${keyword} ${text}` : `${keyword} ${text}`;
                } else {
                    // "Then" as first step? weird but handle it as action with result
                     currentStep = { action: "Check Condition", expected: `${keyword} ${text}` };
                     adoSteps.push(currentStep);
                }
            } else if (isContinuation) {
                // Append to whatever field was last touched in currentStep
                // We'll simplisticly append to Action if Expected is empty, else Expected
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
                // Given / When -> New Step
                currentStep = { action: `${keyword} ${text}`, expected: "" };
                adoSteps.push(currentStep);
            }
        }
        return adoSteps;
    }

    private async updateAdoTestCase(
        id: number, 
        steps: AdoStep[], 
        tags: string[],
        title: string,
        description: string,
        areaPath: string
    ) {
        try {
            // Check if exists
            try {
                const item = await this.witApi.getWorkItem(id);
                if (!item) {
                     console.warn(`    WARNING: Test Case ${id} not found (getWorkItem returned null). Skipping.`);
                     return;
                }
                
                // Optional: Check if it's actually a Test Case
                const type = item.fields ? item.fields['System.WorkItemType'] : 'Unknown';
                // if (type !== 'Test Case') {
                //    console.warn(`    WARNING: ID ${id} is a ${type}, not a Test Case. Skipping steps update.`);
                //    return;
                // }
            } catch (err: any) {
                if (err.statusCode === 404 || err.status === 404 || (err.message && err.message.includes('404'))) {
                    console.warn(`    WARNING: Test Case ${id} does not exist in ADO (404). Skipping.`);
                    return;
                }
                throw err;
            }

            // Build XML
            let stepsXml = '<steps id="0" last="' + steps.length + '">';
            steps.forEach((step, index) => {
                const stepId = index + 1;
                stepsXml += `
<step id="${stepId}" type="ActionStep">
    <parameterizedString isformatted="true">${this.escapeXml(step.action)}</parameterizedString>
    <parameterizedString isformatted="true">${this.escapeXml(step.expected)}</parameterizedString>
    <description/>
</step>`;
            });
            stepsXml += '</steps>';

            const patchDocument = [
                {
                    op: "add",
                    path: "/fields/Microsoft.VSTS.TCM.Steps",
                    value: stepsXml
                },
                {
                    op: "add",
                    path: "/fields/System.Tags",
                    value: tags.join("; ")
                },
                // {
                //     op: "add",
                //     path: "/fields/System.Title",
                //     value: title
                // },
                {
                    op: "add",
                    path: "/fields/System.Description",
                    value: description
                },
                // {
                //     op: "add",
                //     path: "/fields/System.AreaPath",
                //     value: areaPath
                // },
                /*
                {
                    op: "add",
                    path: "/fields/Microsoft.VSTS.TCM.AutomationStatus",
                    value: "Automated"
                }
                */
            ];

            await this.witApi.updateWorkItem(null, patchDocument, id);
            console.log(`    SUCCESS: Updated TC ${id} steps, tags, fields.`);

        } catch (error) {
            console.error(`    FAILED to update TC ${id}:`, error);
        }
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

// Run
const sync = new FeatureSync();
sync.init().then(() => {
    sync.run('features/**/*.feature');
}).catch(err => console.error(err));
