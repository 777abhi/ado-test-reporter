import * as fs from "fs";
import * as path from "path";
import { ExcelImportService } from "../src/ExcelImportService";
import { ITestCaseService, TestCaseInfo } from "../src/interfaces/ITestCaseService";
import { ITestPlanService, PlanSuiteInfo, SuiteInfo, TestCaseResultWithAttachments } from "../src/interfaces/ITestPlanService";
import { ILogger } from "../src/interfaces/ILogger";
import { IExcelParser } from "../src/interfaces/IExcelParser";
import { TestCaseResult } from "azure-devops-node-api/interfaces/TestInterfaces";

class MockLogger implements ILogger {
  log(_message: string): void {}
  warn(_message: string): void {}
  error(_message: string): void {}
}

class MockTestPlanService implements ITestPlanService {
  async ensurePlan(_planName: string): Promise<PlanSuiteInfo> {
    return { planId: 1, rootSuiteId: 10 };
  }
  async ensureSuite(_planId: number, _planRootSuiteId: number | undefined, _suiteName: string): Promise<SuiteInfo> {
    return { suiteId: 20 };
  }
  async linkTestCasesToSuite(_planId: number, _suiteId: number, _testCaseIds: string[]): Promise<void> {}
  async mapPointsToResults(_planId: number, _suiteId: number, _results: TestCaseResult[]): Promise<number[]> {
    return [];
  }
  async createRunAndPublish(
    _planId: number,
    _suiteName: string,
    _buildId: number,
    _buildNumber: string,
    _results: TestCaseResultWithAttachments[],
    _pointIds: number[],
    _attachmentPath?: string
  ): Promise<{ runId: number; runUrl: string }> {
    return { runId: 100, runUrl: "http://run" };
  }
  async isTestFlaky(_testCaseId: number, _testName: string): Promise<boolean> {
    return false;
  }
}

class MockTestCaseService implements ITestCaseService {
  public updatedFields: Record<string, any> | undefined;
  public getHtmlFieldsCalled = false;

  async resolve(_testName: string, _candidateId?: string | null): Promise<TestCaseInfo> {
    return { id: 101, revision: 1, title: "TC1" };
  }
  async updateTestCase(_testCaseId: number, fields: Record<string, any>): Promise<void> {
    this.updatedFields = fields;
  }
  async linkRequirementsById(_testCaseId: number, _requirementIds: number[]): Promise<void> {}
  async getTestCase(_id: number): Promise<TestCaseInfo | null> {
    return { id: 101, revision: 1, title: "TC1" };
  }
  async getHtmlFields(): Promise<Set<string>> {
    this.getHtmlFieldsCalled = true;
    return new Set(["Custom.MyHtmlField"]);
  }
}

class MockExcelParser implements IExcelParser {
  parse(_filePath: string): any[] {
    return [
      {
        ID: "101",
        Title: "TC1",
        MyHtml: "<script>alert('xss')</script>",
        MyPlain: "<script>alert('plain')</script>",
      },
    ];
  }
}

describe("ExcelImportService HTML Fields Security", () => {
  const mappingPath = path.resolve(__dirname, "temp_mapping_html_test.json");

  afterEach(() => {
    if (fs.existsSync(mappingPath)) {
      fs.unlinkSync(mappingPath);
    }
  });

  it("should dynamically fetch HTML fields and sanitize them while leaving plain fields safe", async () => {
    const logger = new MockLogger();
    const planService = new MockTestPlanService();
    const parser = new MockExcelParser();
    const tcService = new MockTestCaseService();

    const mapping = {
      "System.Id": "ID",
      "System.Title": "Title",
      "Custom.MyHtmlField": "MyHtml",
      "Custom.MyPlainField": "MyPlain",
    };
    fs.writeFileSync(mappingPath, JSON.stringify(mapping));

    const service = new ExcelImportService(
      tcService,
      planService,
      logger,
      parser,
      []
    );

    await service.importTestCases("dummy.xlsx", mappingPath, "Plan", "Suite");

    expect(tcService.getHtmlFieldsCalled).toBe(true);
    expect(tcService.updatedFields).toBeDefined();

    const htmlVal = tcService.updatedFields!["Custom.MyHtmlField"];
    const plainVal = tcService.updatedFields!["Custom.MyPlainField"];

    expect(htmlVal).toContain("&lt;script&gt;");
    expect(htmlVal).not.toContain("<script>");
    expect(plainVal).toBe("<script>alert('plain')</script>");
  });
});
