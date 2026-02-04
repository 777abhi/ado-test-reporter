export interface IExcelImportService {
    importTestCases(
        filePath: string,
        mappingPath: string,
        planName: string,
        suiteName: string
    ): Promise<void>;
}
