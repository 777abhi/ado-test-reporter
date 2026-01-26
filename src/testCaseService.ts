import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import {
  JsonPatchOperation,
  Operation,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import { WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
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
    let info: TestCaseInfo | null = null;

    const existingFromId = await this.tryGetExistingById(testName, candidateId);
    if (existingFromId) {
      info = existingFromId;
    } else {
      // Fallback: If ID lookup failed (or no ID), try searching by name if enabled.
      if (this.fallbackToNameSearch) {
        const existingByName = await this.findByName(testName);
        if (existingByName) {
          info = existingByName;
        }
      }
    }

    if (!info && this.byName.has(testName)) {
      const cached = this.byName.get(testName)!;
      this.logger.log(
        `ℹ️ Test Case "${testName}" already exists (ID: ${cached.id}); skipping creation.`
      );
      info = cached;
    }

    if (!info) {
      if (!this.autoCreateTestCases) {
        throw new Error(
          `Test Case "${testName}" not found and auto-create is disabled (ADO_AUTO_CREATE_TEST_CASES=false).`
        );
      }
      info = await this.createTestCase(testName);
    }

    // Attempt to link requirements parsed from the name
    await this.linkRequirements(info.id, testName);

    return info;
  }

  private async tryGetExistingById(
    testName: string,
    candidateId?: string | null
  ): Promise<TestCaseInfo | null> {
    if (!candidateId) return null;
    const parsedId = parseInt(candidateId, 10);
    if (isNaN(parsedId)) {
      this.logger.warn(`⚠️ Invalid Test Case ID provided: "${candidateId}"; ignoring.`);
      return null;
    }

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

  private async linkRequirements(testCaseId: number, textToParse: string): Promise<void> {
    // Regex to find Requirement IDs (e.g. Story123, AB#456, Requirement 789)
    const reqRegex = /(?:Story|Requirement|Bug|Task|UserStory|Feature|Epic|Issue|AB#?)\s*(\d+)/ig;
    const matches = Array.from(textToParse.matchAll(reqRegex));

    if (matches.length === 0) return;

    try {
      // Check existing relations
      const workItem = await this.workItemApi.getWorkItem(
        testCaseId,
        undefined,
        undefined,
        WorkItemExpand.Relations,
        this.project
      );

      const existingUrls = new Set(
        (workItem?.relations || []).map((r) => r.url)
      );

      const uniqueIds = new Set(matches.map((m) => m[1])); // Extract the ID group

      for (const reqId of uniqueIds) {
        // Assume reqId is a work item ID.
        // Link type: Microsoft.VSTS.Common.TestedBy-Reverse (Test Case -> Tests -> Requirement)
        // Or System.LinkTypes.Dependency
        // The "Tests" link type is what connects TC to Story.
        // It's often "Microsoft.VSTS.Common.TestedBy-Reverse".

        // Need URL for the target work item
        // We can construct it if we don't have it, but safest is to check if it exists?
        // Actually, we can just construct the URL standard ADO format.
        // But we need the org URL context. I don't have orgUrl here, only workItemApi and project.
        // workItemApi has `serverUrl`.

        // Actually, I can search for the work item to get its URL?
        // Or I can use existingFromId logic?

        // Wait, I don't have orgUrl stored in this service.
        // But `this.workItemApi` is initialized with the server URL implicitly.
        // However, constructing the URL for relation requires the full URL.
        // Let's try to get the work item first to be safe and get its URL.

        try {
            const reqItem = await this.workItemApi.getWorkItem(parseInt(reqId, 10));
            if (!reqItem || !reqItem.url) continue;

            if (existingUrls.has(reqItem.url)) {
                continue;
            }

            const patch: JsonPatchOperation[] = [
                {
                    op: Operation.Add,
                    path: "/relations/-",
                    value: {
                        rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
                        url: reqItem.url,
                        attributes: { comment: "Auto-linked from Test Name" },
                    },
                },
            ];

            await this.workItemApi.updateWorkItem(
                undefined,
                patch,
                testCaseId,
                this.project
            );
            this.logger.log(`🔗 Auto-linked TC ${testCaseId} to Requirement ${reqId}`);

        } catch (e) {
            this.logger.warn(`⚠️ Failed to link TC ${testCaseId} to Req ${reqId}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.warn(`⚠️ Error in linkRequirements for TC ${testCaseId}: ${(e as Error).message}`);
    }
  }
}
