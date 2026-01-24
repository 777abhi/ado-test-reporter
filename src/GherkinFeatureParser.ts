import * as glob from 'glob';
import { GherkinStreams } from '@cucumber/gherkin-streams';
import * as messages from '@cucumber/messages';
import { IFeatureParser } from './interfaces/IFeatureParser';
import { ParsedScenario, ParsedStep } from './interfaces/IParsedScenario';

export class GherkinFeatureParser implements IFeatureParser {
    public async parse(pattern: string): Promise<ParsedScenario[]> {
        console.log(`Searching for feature files: ${pattern}`);
        const files = glob.sync(pattern);

        if (files.length === 0) {
            console.log("No feature files found.");
            return [];
        }

        const parsedScenarios: ParsedScenario[] = [];

        const stream = GherkinStreams.fromPaths(files, {
            newId: messages.IdGenerator.uuid(),
        });

        await new Promise<void>((resolve, reject) => {
            stream.on('data', (envelope: messages.Envelope) => {
                if (envelope.gherkinDocument) {
                    const feature = envelope.gherkinDocument.feature;
                    if (!feature) return;

                    const featureName = feature.name;
                    const featureDescription = feature.description || '';
                    const featureTags = feature.tags ? feature.tags.map(t => t.name) : [];

                    let backgroundSteps: readonly messages.Step[] = [];
                    const background = feature.children.find(c => c.background)?.background;
                    if (background) {
                       backgroundSteps = background.steps;
                    }

                    for (const child of feature.children) {
                        if (child.scenario) {
                            this.processScenario(child.scenario, backgroundSteps, featureTags, featureName, featureDescription, parsedScenarios);
                        } else if (child.rule) {
                            const rule = child.rule;
                            let ruleBackgroundSteps: readonly messages.Step[] = [];
                            const ruleBackground = rule.children.find(c => c.background)?.background;
                            if (ruleBackground) {
                                ruleBackgroundSteps = ruleBackground.steps;
                            }
                            const combinedBackground = [...backgroundSteps, ...ruleBackgroundSteps];
                            const ruleTags = rule.tags ? rule.tags.map(t => t.name) : [];
                            const combinedTags = [...featureTags, ...ruleTags];

                            for (const ruleChild of rule.children) {
                                if (ruleChild.scenario) {
                                    this.processScenario(ruleChild.scenario, combinedBackground, combinedTags, featureName, featureDescription, parsedScenarios);
                                }
                            }
                        }
                    }
                }
            });
            stream.on('end', () => resolve());
            stream.on('error', (err) => reject(err));
        });

        return parsedScenarios;
    }

    private processScenario(
        scenario: messages.Scenario,
        backgroundSteps: readonly messages.Step[],
        inheritedTags: string[] = [],
        featureName: string,
        featureDescription: string,
        results: ParsedScenario[]
    ) {
        // Combine Background Steps + Scenario Steps
        const allSteps = [...backgroundSteps, ...scenario.steps];

        // Combine tags
        const scenarioTags = scenario.tags ? scenario.tags.map(t => t.name) : [];
        const allTags = Array.from(new Set([...inheritedTags, ...scenarioTags]));

        // Extract ID - replicating original logic which seemingly only looked at scenario tags for ID?
        // Actually, looking at scenario tags is safer.
        const tcTag = scenarioTags.find(t => t.startsWith('@TC_'));
        let tcId: number | undefined;
        if (tcTag) {
            tcId = parseInt(tcTag.substring(4));
        }

        const parsedSteps: ParsedStep[] = allSteps.map(step => ({
            keyword: step.keyword,
            text: step.text
        }));

        results.push({
            name: scenario.name,
            description: scenario.description || '',
            tags: allTags,
            steps: parsedSteps,
            tcId: tcId,
            featureName,
            featureDescription
        });
    }
}
