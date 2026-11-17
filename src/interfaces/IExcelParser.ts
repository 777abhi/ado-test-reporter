export interface IExcelParser {
    parse(filePath: string): Promise<any[]> | any[];
}
