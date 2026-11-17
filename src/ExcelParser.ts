import ExcelJS from 'exceljs';
import * as fs from 'fs';
import { IExcelParser } from './interfaces/IExcelParser';

function normalizeCellValue(value: ExcelJS.CellValue): any {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value === 'object') {
        if (value instanceof Date) {
            return value.toISOString();
        }
        if ('richText' in value && Array.isArray(value.richText)) {
            return value.richText.map((part) => part.text).join('');
        }
        if ('text' in value) {
            return value.text;
        }
        if ('result' in value) {
            return value.result;
        }
    }
    return value;
}

export class ExcelParser implements IExcelParser {
    public async parse(filePath: string): Promise<any[]> {
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

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);

        if (workbook.worksheets.length === 0) {
            throw new Error(`Excel file "${filePath}" has no sheets.`);
        }

        const sheet = workbook.worksheets[0];
        const headers: string[] = [];
        const rows: any[] = [];

        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) {
                row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    const headerVal = normalizeCellValue(cell.value);
                    headers[colNumber] = headerVal !== undefined ? String(headerVal).trim() : '';
                });
                return;
            }

            const record: Record<string, any> = {};
            let hasValue = false;

            for (let colNumber = 1; colNumber < headers.length; colNumber++) {
                const header = headers[colNumber];
                if (!header) continue;
                const cellVal = normalizeCellValue(row.getCell(colNumber).value);
                if (cellVal !== undefined && cellVal !== '') {
                    record[header] = cellVal;
                    hasValue = true;
                }
            }

            if (hasValue) {
                rows.push(record);
            }
        });

        return rows;
    }
}
