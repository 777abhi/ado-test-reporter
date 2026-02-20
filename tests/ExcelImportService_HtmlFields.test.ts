
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ExcelImportService } from '../src/ExcelImportService';
import { ITestCaseService, TestCaseInfo } from '../src/interfaces/ITestCaseService';
import { ITestPlanService, PlanSuiteInfo, SuiteInfo, TestCaseResultWithAttachments } from '../src/interfaces/ITestPlanService';
import { ILogger } from '../src/interfaces/ILogger';
import { IExcelParser } from '../src/interfaces/IExcelParser';
import { TestCaseResult } from 'azure-devops-node-api/interfaces/TestInterfaces';

class MockLogger implements ILogger {
    log(message: string): void {}
    warn(message: string): void {}
    error(message: string): void {}
}

class MockTestPlanService implements ITestPlanService {
    async ensurePlan(planName: string): Promise<PlanSuiteInfo> {
        return { planId: 1, rootSuiteId: 10 };
    }
    async ensureSuite(planId: number, planRootSuiteId: number | undefined, suiteName: string): Promise<SuiteInfo> {
        return { suiteId: 20 };
    }
    async linkTestCasesToSuite(planId: number, suiteId: number, testCaseIds: string[]): Promise<void> {}
    async mapPointsToResults(planId: number, suiteId: number, results: TestCaseResult[]): Promise<number[]> {
        return [];
    }
    async createRunAndPublish(
        planId: number,
        suiteName: string,
        buildId: number,
        buildNumber: string,
        results: TestCaseResultWithAttachments[],
        pointIds: number[],
        attachmentPath?: string
    ): Promise<{ runId: number; runUrl: string }> {
        return { runId: 100, runUrl: 'http://run' };
    }
}

class MockTestCaseService implements ITestCaseService {
    public updatedFields: Record<string, any> | undefined;
    public getHtmlFieldsCalled = false;

    async resolve(testName: string, candidateId?: string | null): Promise<TestCaseInfo> {
        return { id: 101, revision: 1, title: "TC1" };
    }
    async updateTestCase(testCaseId: number, fields: Record<string, any>): Promise<void> {
        this.updatedFields = fields;
    }
    async linkRequirementsById(testCaseId: number, requirementIds: number[]): Promise<void> {}
    async getTestCase(id: number): Promise<TestCaseInfo | null> {
        return { id: 101, revision: 1, title: "TC1" };
    }
    async getHtmlFields(): Promise<Set<string>> {
        this.getHtmlFieldsCalled = true;
        // Mock returning a custom HTML field
        return new Set(["Custom.MyHtmlField"]);
    }
}

class MockExcelParser implements IExcelParser {
    parse(filePath: string): any[] {
        // Return rows simulating Excel content
        return [
            {
                "ID": "101",
                "Title": "TC1",
                "MyHtml": "<script>alert('xss')</script>",
                "MyPlain": "<script>alert('plain')</script>"
            }
        ];
    }
}

async function runTest() {
    console.log("---------------------------------------------------");
    console.log("Running ExcelImportService Security Test (HTML Fields)");
    console.log("---------------------------------------------------");

    const logger = new MockLogger();
    const planService = new MockTestPlanService();
    const parser = new MockExcelParser();
    const tcService = new MockTestCaseService();

    // Create a temporary mapping file
    const mappingPath = path.resolve(__dirname, 'temp_mapping.json');
    const mapping = {
        "System.Id": "ID",
        "System.Title": "Title",
        "Custom.MyHtmlField": "MyHtml",  // This field should be sanitized because getHtmlFields returns it
        "Custom.MyPlainField": "MyPlain" // This field should NOT be sanitized (treated as plain text)
    };
    fs.writeFileSync(mappingPath, JSON.stringify(mapping));

    try {
        const service = new ExcelImportService(
            tcService,
            planService,
            logger,
            parser,
            [] // No manual HTML fields passed
        );

        await service.importTestCases("dummy.xlsx", mappingPath, "Plan", "Suite");

        // Verification 1: getHtmlFields was called
        if (!tcService.getHtmlFieldsCalled) {
            throw new Error("FAIL: getHtmlFields() was NOT called.");
        }
        console.log("✅ PASS: getHtmlFields() was called dynamically.");

        // Verification 2: Check sanitization
        const fields = tcService.updatedFields;
        if (!fields) {
            throw new Error("FAIL: updateTestCase was not called.");
        }

        const htmlVal = fields["Custom.MyHtmlField"];
        const plainVal = fields["Custom.MyPlainField"];

        console.log(`[DEBUG] HTML Value: ${htmlVal}`);
        console.log(`[DEBUG] Plain Value: ${plainVal}`);

        // HTML field MUST be escaped
        if (!htmlVal.includes("&lt;script&gt;") || htmlVal.includes("<script>")) {
            throw new Error(`FAIL: HTML field was not sanitized! Value: ${htmlVal}`);
        }
        console.log("✅ PASS: HTML field was correctly sanitized.");

        // Plain field should REMAIN as is (ADO treats it as plain text)
        // If we sanitize everything, this would be escaped too.
        // But current logic only sanitizes KNOWN HTML fields.
        if (plainVal !== "<script>alert('plain')</script>") {
            console.warn("⚠️ Plain text field was modified. This might be intentional if policy changed to sanitize everything, but expected behavior was preserving text.");
        } else {
            console.log("✅ PASS: Plain text field preserved (safe for text fields).");
        }

    } finally {
        if (fs.existsSync(mappingPath)) fs.unlinkSync(mappingPath);
    }
}

// Execute
if (require.main === module) {
    runTest().catch(e => {
        console.error(e);
        process.exit(1);
    });
}
