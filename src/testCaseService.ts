import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import {
  JsonPatchOperation,
  Operation,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import { WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { ITestCaseService, TestCaseInfo } from "./interfaces/ITestCaseService";
import { ILogger } from "./interfaces/ILogger";
import { escapeWiqlString } from "./utils/WiqlUtils";
import { sanitizeForCsv } from "./utils/CsvUtils";

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

  async getTestCase(id: number): Promise<TestCaseInfo | null> {
    if (this.byId.has(id)) {
      return this.byId.get(id)!;
    }
    try {
      const existing = await this.workItemApi.getWorkItem(
        id,
        ["System.Title", "System.Rev"],
        undefined,
        undefined,
        this.project
      );
      const info: TestCaseInfo = {
        id: existing.id!,
        revision: existing.rev ?? 1,
        title: existing.fields?.["System.Title"] || "",
      };
      this.byId.set(id, info);
      return info;
    } catch (e) {
      this.logger.warn(`⚠️ Test Case ${id} not found.`);
      return null;
    }
  }

  async updateTestCase(testCaseId: number, fields: Record<string, any>): Promise<void> {
    // Sentinel: Sanitize Title for CSV/Formula Injection
    if (fields["System.Title"] && typeof fields["System.Title"] === 'string') {
        fields["System.Title"] = sanitizeForCsv(fields["System.Title"]);
    }
    // Also handle if passed as /fields/System.Title
    if (fields["/fields/System.Title"] && typeof fields["/fields/System.Title"] === 'string') {
        fields["/fields/System.Title"] = sanitizeForCsv(fields["/fields/System.Title"]);
    }

    const patch: JsonPatchOperation[] = Object.keys(fields).map((key) => ({
      op: Operation.Add,
      path: key.startsWith("/") ? key : `/fields/${key}`,
      value: fields[key],
    }));

    try {
      const updated = await this.workItemApi.updateWorkItem(
        undefined,
        patch,
        testCaseId,
        this.project
      );
      if (updated && updated.rev) {
        // Update cache if exists
        const cached = this.byId.get(testCaseId);
        if (cached) {
          cached.revision = updated.rev;
        }
      }
      this.logger.log(`✅ Updated Test Case ${testCaseId} fields.`);
    } catch (e) {
      this.logger.error(`❌ Failed to update Test Case ${testCaseId}:`, (e as Error).message);
      throw e;
    }
  }

  async linkRequirementsById(testCaseId: number, requirementIds: number[]): Promise<void> {
    if (requirementIds.length === 0) return;

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

      const uniqueIds = [...new Set(requirementIds)];

      // Fetch all requirements in parallel to get their URLs
      const reqItems = await Promise.all(
        uniqueIds.map((id) =>
          this.workItemApi.getWorkItem(id).catch((e) => {
            this.logger.warn(`⚠️ Failed to fetch Req ${id}: ${(e as Error).message}`);
            return null;
          })
        )
      );

      const patch: JsonPatchOperation[] = [];

      for (const reqItem of reqItems) {
        if (!reqItem || !reqItem.url) continue;
        if (existingUrls.has(reqItem.url)) continue;

        patch.push({
          op: Operation.Add,
          path: "/relations/-",
          value: {
            rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
            url: reqItem.url,
            attributes: { comment: "Auto-linked" },
          },
        });
        existingUrls.add(reqItem.url);
      }

      if (patch.length > 0) {
        await this.workItemApi.updateWorkItem(
          undefined,
          patch,
          testCaseId,
          this.project
        );
        this.logger.log(
          `🔗 Linked TC ${testCaseId} to Requirements: ${uniqueIds.join(", ")}`
        );
      }
    } catch (e) {
      this.logger.warn(
        `⚠️ Error in linkRequirementsById for TC ${testCaseId}: ${(e as Error).message}`
      );
    }
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

    // Reuse getTestCase if possible, but here we are resolving by ID AND setting the Name map.
    // getTestCase just gets by ID.
    // Let's stick to existing logic to handle name mapping too.

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
    const escapedProject = escapeWiqlString(this.project);
    const escapedTestName = escapeWiqlString(testName);

    // Sentinel: Search for both original and sanitized name to prevent duplicates
    const sanitized = sanitizeForCsv(testName);
    let whereClause = `[System.Title] = '${escapedTestName}'`;

    if (sanitized !== testName) {
        const escapedSanitized = escapeWiqlString(sanitized);
        whereClause = `(${whereClause} OR [System.Title] = '${escapedSanitized}')`;
        this.logger.log(`🔍 Including sanitized search: "${sanitized}"`);
    }

    const wiql = `SELECT [System.Id], [System.Rev], [System.Title] FROM WorkItems WHERE [System.TeamProject] = '${escapedProject}' AND [System.WorkItemType] = 'Test Case' AND ${whereClause}`;

    try {
      const result = await this.workItemApi.queryByWiql({ query: wiql });
      if (result.workItems && result.workItems.length > 0) {
        // Return first match (preference could be given to exact match, but usually implies one exists)
        const firstMatch = result.workItems[0];
        if (firstMatch.id) {
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
    // Sentinel: Sanitize Title for CSV/Formula Injection
    const titleToUse = sanitizeForCsv(testName);
    if (titleToUse !== testName) {
        this.logger.log(`🛡️ Sanitizing Test Case Title for creation: "${testName}" -> "${titleToUse}"`);
    }

    const patchDocument: JsonPatchOperation[] = [
      { op: Operation.Add, path: "/fields/System.Title", value: titleToUse },
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
      title: titleToUse,
    };
    this.byId.set(created.id, info);
    this.byName.set(testName, info); // Cache with original name so we don't recreate
    this.logger.log(`🆕 Created Test Case ${created.id} for "${testName}" (Title: ${titleToUse})`);
    return info;
  }

  private async linkRequirements(testCaseId: number, textToParse: string): Promise<void> {
    // Regex to find Requirement IDs (e.g. Story123, AB#456, Requirement 789)
    const reqRegex = /(?:Story|Requirement|Bug|Task|UserStory|Feature|Epic|Issue|AB#?)\s*(\d+)/ig;
    const ids: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = reqRegex.exec(textToParse)) !== null) {
        const id = parseInt(match[1], 10);
        if (!isNaN(id)) {
            ids.push(id);
        }
    }

    if (ids.length === 0) return;

    await this.linkRequirementsById(testCaseId, ids);
  }
}
