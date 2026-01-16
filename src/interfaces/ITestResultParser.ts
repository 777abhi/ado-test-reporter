
export type ParsedTestCase = {
    name: string;
    durationMs: number;
    outcome: "Passed" | "Failed";
    errorMessage?: string;
};

export interface ITestResultParser {
    parse(filePath: string): Promise<ParsedTestCase[]>;
}
