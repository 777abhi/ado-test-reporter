import * as fs from 'fs';
import { IExcelImportService } from './interfaces/IExcelImportService';
import { ITestCaseService } from './interfaces/ITestCaseService';
import { ITestPlanService } from './interfaces/ITestPlanService';
import { ILogger } from './interfaces/ILogger';
import { IExcelParser } from './interfaces/IExcelParser';
import { escapeXml } from './utils/XmlUtils';

export class ExcelImportService implements IExcelImportService {
    private readonly htmlFields = new Set([
        "System.Description",
        "System.History",
        "Microsoft.VSTS.TCM.ReproSteps",
        "Microsoft.VSTS.TCM.Steps",
        "Microsoft.VSTS.Common.AcceptanceCriteria"
    ]);

    constructor(
        private testCaseService: ITestCaseService,
        private testPlanService: ITestPlanService,
        private logger: ILogger,
        private parser: IExcelParser,
        additionalHtmlFields: string[] = []
    ) {
        if (additionalHtmlFields) {
            additionalHtmlFields.forEach((f) => this.htmlFields.add(f));
        }
    }

    public async importTestCases(
        filePath: string,
        mappingPath: string,
        planName: string,
        suiteName: string
    ): Promise<void> {
        if (!fs.existsSync(mappingPath)) {
            throw new Error(`Mapping file not found: ${mappingPath}`);
        }

        const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8')) as Record<string, string>;
        this.logger.log(`Loaded mapping from ${mappingPath}`);

        const rows = this.parser.parse(filePath);
        this.logger.log(`Parsed ${rows.length} rows from ${filePath}`);

        const testCaseIds: string[] = [];

        for (const row of rows) {
            // Identify ID and Title columns from mapping
            const idField = "System.Id";
            const titleField = "System.Title";

            const idCol = mapping[idField];
            const titleCol = mapping[titleField];

            let tcId: number | undefined;
            let tcTitle: string | undefined;

            if (idCol && row[idCol] !== undefined) {
                const parsed = parseInt(row[idCol], 10);
                if (!isNaN(parsed)) {
                    tcId = parsed;
                }
            }
            if (titleCol && row[titleCol]) {
                tcTitle = String(row[titleCol]);
            }

            // If we have an ID, try to find it
            if (tcId) {
                const existing = await this.testCaseService.getTestCase(tcId);
                if (existing) {
                    this.logger.log(`Found existing TC ${tcId}. Updating...`);
                } else {
                    this.logger.warn(`TC ${tcId} not found in ADO. Treating as new or skipping depending on Title availability.`);
                    tcId = undefined; // Fallback to create if title exists
                }
            }

            // If no ID (or not found), resolve by Title
            if (!tcId) {
                if (!tcTitle) {
                    this.logger.warn(`Row skipped: No ID and no Title found (Columns: ${idCol}, ${titleCol}). Row: ${JSON.stringify(row)}`);
                    continue;
                }
                const info = await this.testCaseService.resolve(tcTitle);
                tcId = info.id;
            }

            if (!tcId) {
                this.logger.error(`Failed to resolve Test Case for row: ${JSON.stringify(row)}`);
                continue;
            }

            testCaseIds.push(String(tcId));

            // Prepare fields to update
            const fields: Record<string, any> = {};
            for (const [adoField, excelCol] of Object.entries(mapping)) {
                if (adoField === "System.Id") continue; // Don't update ID field directly via generic update

                if (row[excelCol] !== undefined) {
                    let value = row[excelCol];
                    if (this.htmlFields.has(adoField) && typeof value === 'string') {
                        value = escapeXml(value);
                    }
                    fields[adoField] = value;
                }
            }

            if (Object.keys(fields).length > 0) {
                await this.testCaseService.updateTestCase(tcId, fields);
            }
        }

        if (testCaseIds.length === 0) {
            this.logger.warn("No test cases processed.");
            return;
        }

        // Link to Plan/Suite
        this.logger.log(`Ensuring Test Plan: ${planName}`);
        const planInfo = await this.testPlanService.ensurePlan(planName);

        this.logger.log(`Ensuring Test Suite: ${suiteName}`);
        const suiteInfo = await this.testPlanService.ensureSuite(planInfo.planId, planInfo.rootSuiteId, suiteName);

        this.logger.log(`Linking ${testCaseIds.length} test cases to suite.`);
        await this.testPlanService.linkTestCasesToSuite(planInfo.planId, suiteInfo.suiteId, testCaseIds);

        this.logger.log("Import completed successfully.");
    }
}
