import * as xlsx from 'xlsx';
import * as fs from 'fs';
import { IExcelParser } from './interfaces/IExcelParser';

export class ExcelParser implements IExcelParser {
    public parse(filePath: string): any[] {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Excel file not found: ${filePath}`);
        }

        const stats = fs.statSync(filePath);

        // Sentinel: Prevent directory traversal or device file usage
        if (!stats.isFile()) {
            throw new Error(`Excel path is not a file: ${filePath}`);
        }

        // Sentinel: Prevent DoS by limiting file size to 50MB
        const MAX_FILE_SIZE = 50 * 1024 * 1024;
        if (stats.size > MAX_FILE_SIZE) {
            throw new Error(
                `Excel file is too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Max allowed: 50MB.`
            );
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
