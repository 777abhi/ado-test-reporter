import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import {
  JsonPatchOperation,
  Operation,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";

export type TestCaseInfo = { id: number; revision: number; title: string };

export class TestCaseService {
  private byId = new Map<number, TestCaseInfo>();
  private byName = new Map<string, TestCaseInfo>();

  constructor(
    private workItemApi: IWorkItemTrackingApi,
    private project: string
  ) {}

  async resolve(testName: string, candidateId?: string | null): Promise<TestCaseInfo> {
    const existingFromId = await this.tryGetExistingById(testName, candidateId);
    if (existingFromId) return existingFromId;

    if (this.byName.has(testName)) {
      const cached = this.byName.get(testName)!;
      console.log(
        `ℹ️ Test Case "${testName}" already exists (ID: ${cached.id}); skipping creation.`
      );
      return cached;
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
      console.log(`ℹ️ Using existing Test Case ${parsedId} for "${testName}".`);
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
      console.log(`ℹ️ Using existing Test Case ${parsedId} for "${testName}".`);
      return info;
    } catch (err) {
      console.warn(
        `⚠️ Test Case ID ${parsedId} not found; creating a new test case for "${testName}".`
      );
      return null;
    }
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
    console.log(`🆕 Created Test Case ${created.id} for "${testName}"`);
    return info;
  }
}
