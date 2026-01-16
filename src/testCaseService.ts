import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import {
  JsonPatchOperation,
  Operation,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import { ITestCaseService, TestCaseInfo } from "./interfaces/ITestCaseService";
import { ILogger } from "./interfaces/ILogger";

export class TestCaseService implements ITestCaseService {
  private byId = new Map<number, TestCaseInfo>();
  private byName = new Map<string, TestCaseInfo>();

  constructor(
    private workItemApi: IWorkItemTrackingApi,
    private project: string,
    private fallbackToNameSearch: boolean,
    private autoCreateTestCases: boolean,
    private logger: ILogger
  ) { }

  async resolve(testName: string, candidateId?: string | null): Promise<TestCaseInfo> {
    const existingFromId = await this.tryGetExistingById(testName, candidateId);
    if (existingFromId) return existingFromId;

    // Fallback: If ID lookup failed (or no ID), try searching by name if enabled.
    if (this.fallbackToNameSearch) {
      const existingByName = await this.findByName(testName);
      if (existingByName) return existingByName;
    }

    if (this.byName.has(testName)) {
      const cached = this.byName.get(testName)!;
      this.logger.log(
        `ℹ️ Test Case "${testName}" already exists (ID: ${cached.id}); skipping creation.`
      );
      return cached;
    }

    if (!this.autoCreateTestCases) {
      throw new Error(
        `Test Case "${testName}" not found and auto-create is disabled (ADO_AUTO_CREATE_TEST_CASES=false).`
      );
    }

    return this.createTestCase(testName);
  }

  private async tryGetExistingById(
    testName: string,
    candidateId?: string | null
  ): Promise<TestCaseInfo | null> {
    if (!candidateId) return null;
    const parsedId = parseInt(candidateId, 10);
    if (isNaN(parsedId)) return null;

    if (this.byId.has(parsedId)) {
      const cached = this.byId.get(parsedId)!;
      this.logger.log(`ℹ️ Using existing Test Case ${parsedId} for "${testName}".`);
      return cached;
    }

    try {
      const existing = await this.workItemApi.getWorkItem(
        parsedId,
        undefined,
        undefined,
        undefined,
        this.project
      );
      const info: TestCaseInfo = {
        id: parsedId,
        revision: existing.rev ?? 1,
        title: existing.fields?.["System.Title"] || testName,
      };
      this.byId.set(parsedId, info);
      this.byName.set(testName, info);
      this.logger.log(`ℹ️ Using existing Test Case ${parsedId} for "${testName}".`);
      return info;
    } catch (err) {
      this.logger.warn(
        `⚠️ Test Case ID ${parsedId} not found; proceeding.`
      );
      return null;
    }
  }

  private async findByName(testName: string): Promise<TestCaseInfo | null> {
    this.logger.log(`🔍 Searching for Test Case by name: "${testName}"`);
    const wiql = `SELECT [System.Id], [System.Rev], [System.Title] FROM WorkItems WHERE [System.TeamProject] = '${this.project}' AND [System.WorkItemType] = 'Test Case' AND [System.Title] = '${testName}'`;

    try {
      const result = await this.workItemApi.queryByWiql({ query: wiql });
      if (result.workItems && result.workItems.length > 0) {
        const firstMatch = result.workItems[0];
        if (firstMatch.id) {
          // Fetch full item to get revision? unique query doesn't give rev usually unless specified
          // Actually getWorkItem usually needed to get current rev reliably if not in query results
          const existing = await this.workItemApi.getWorkItem(
            firstMatch.id,
            ["System.Title", "System.Rev"]
          );

          const info: TestCaseInfo = {
            id: firstMatch.id,
            revision: existing.rev ?? 1,
            title: testName
          };
          this.byId.set(info.id, info);
          this.byName.set(testName, info);
          this.logger.log(`✅ Found Test Case by name: ${info.id} -> "${testName}"`);
          return info;
        }
      }
    } catch (err) {
      this.logger.warn(`⚠️ Error searching for test case by name: ${err}`);
    }
    this.logger.log(`⚠️ No existing Test Case found with name "${testName}".`);
    return null;
  }

  private async createTestCase(testName: string): Promise<TestCaseInfo> {
    const patchDocument: JsonPatchOperation[] = [
      { op: Operation.Add, path: "/fields/System.Title", value: testName },
      { op: Operation.Add, path: "/fields/System.AreaPath", value: this.project },
      { op: Operation.Add, path: "/fields/System.IterationPath", value: this.project },
    ];

    const created = await this.workItemApi.createWorkItem(
      undefined,
      patchDocument,
      this.project,
      "Test Case"
    );

    if (!created.id) {
      throw new Error(`Failed to create test case for "${testName}".`);
    }

    const info: TestCaseInfo = {
      id: created.id,
      revision: created.rev ?? 1,
      title: testName,
    };
    this.byId.set(created.id, info);
    this.byName.set(testName, info);
    this.logger.log(`🆕 Created Test Case ${created.id} for "${testName}"`);
    return info;
  }
}
