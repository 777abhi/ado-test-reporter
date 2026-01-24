export interface ParsedStep {
    keyword: string;
    text: string;
}

export interface ParsedScenario {
    name: string;
    description: string;
    tags: string[];
    steps: ParsedStep[];
    tcId?: number; // The extracted ID if present
    featureName: string;
    featureDescription: string;
}
