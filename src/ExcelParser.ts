import * as xlsx from 'xlsx';
import * as fs from 'fs';
import { IExcelParser } from './interfaces/IExcelParser';

export class ExcelParser implements IExcelParser {
    public parse(filePath: string): any[] {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Excel file not found: ${filePath}`);
        }

        const workbook = xlsx.readFile(filePath);
        if (workbook.SheetNames.length === 0) {
            throw new Error(`Excel file "${filePath}" has no sheets.`);
        }

        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        return xlsx.utils.sheet_to_json(sheet);
    }
}
