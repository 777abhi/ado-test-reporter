import { IFailureTaskService, FailureInfo } from "./interfaces/IFailureTaskService";
import { ILogger } from "./interfaces/ILogger";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import {
  JsonPatchOperation,
  Operation,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import { Wiql } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { escapeWiqlString } from "./utils/WiqlUtils";
import { escapeXml } from "./utils/XmlUtils";

export class FailureTaskService implements IFailureTaskService {
  constructor(
    private workItemApi: IWorkItemTrackingApi,
    private project: string,
    private orgUrl: string,
    private logger: ILogger,
    private defectType: string = "Task"
  ) { }

  private async findExistingTask(testCaseId: string): Promise<number | null> {
    const escapedDefectType = escapeWiqlString(this.defectType);
    const escapedTestCaseId = escapeWiqlString(testCaseId);

    const wiql: Wiql = {
      query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE
          [System.TeamProject] = @project
          AND [System.WorkItemType] = '${escapedDefectType}'
          AND [System.Title] CONTAINS '${escapedTestCaseId}'
          AND [System.State] <> 'Closed'
          AND [System.State] <> 'Done'
        ORDER BY [System.ChangedDate] DESC
      `,
    };

    try {
      const result = await this.workItemApi.queryByWiql(wiql, {
        project: this.project,
      });
      const first = result.workItems && result.workItems[0];
      return first?.id ?? null;
    } catch (e) {
      this.logger.warn(
        `⚠️ Failed to query existing task for TC ${testCaseId}:`,
        (e as Error).message
      );
      return null;
    }
  }

  private async addComment(workItemId: number, comment: string): Promise<void> {
    const patch: JsonPatchOperation[] = [
      {
        op: Operation.Add,
        path: "/fields/System.History",
        value: comment,
      },
    ];

    try {
      const updated = await this.workItemApi.updateWorkItem(
        undefined,
        patch,
        workItemId,
        this.project
      );

      if (!updated || !updated.id) {
        throw new Error(`Failed to update Work Item ${workItemId} (No ID returned).`);
      }

      this.logger.log(`✏️ Added comment to task ${workItemId}`);
    } catch (e) {
      this.logger.warn(
        `⚠️ Failed to add comment to task ${workItemId}:`,
        (e as Error).message
      );
    }
  }

  async createTaskForFailure(failure: FailureInfo): Promise<void> {
    const existingTaskId = await this.findExistingTask(failure.testCaseId);
    const comment = [
      `Test failed in build ${escapeXml(failure.buildNumber)}`,
      failure.errorMessage
        ? `Error: <pre>${escapeXml(failure.errorMessage)}</pre>`
        : "No error details.",
      `Run: ${escapeXml(failure.runUrl)}`,
    ].join("<br>");

    if (existingTaskId) {
      this.logger.log(
        `ℹ️ Task ${existingTaskId} already exists for TC ${failure.testCaseId}; adding comment.`
      );
      await this.addComment(existingTaskId, comment);
      return;
    }

    const title = `[Auto] Investigate: ${failure.testName} (TC ${failure.testCaseId})`;
    // Sentinel: Sanitize inputs to prevent Stored XSS in Work Item description
    const description = [
      `<p>Test failed in build <b>${escapeXml(failure.buildNumber)}</b></p>`,
      `<p>Test Case ID: ${escapeXml(failure.testCaseId)}</p>`,
      failure.errorMessage
        ? `<pre>${escapeXml(failure.errorMessage)}</pre>`
        : "<p>No error message provided.</p>",
    ].join("\n");

    const descriptionField =
      this.defectType.toLowerCase() === "bug"
        ? "/fields/Microsoft.VSTS.TCM.ReproSteps"
        : "/fields/System.Description";

    const patch: JsonPatchOperation[] = [
      { op: Operation.Add, path: "/fields/System.Title", value: title },
      { op: Operation.Add, path: "/fields/System.AreaPath", value: this.project },
      { op: Operation.Add, path: "/fields/System.IterationPath", value: this.project },
      { op: Operation.Add, path: descriptionField, value: description },
      { op: Operation.Add, path: "/fields/System.Tags", value: "AutomatedTestFailure" },
    ];

    try {
      const relationPatch: JsonPatchOperation = {
        op: Operation.Add,
        path: "/relations/-",
        value: {
          rel: "System.LinkTypes.Related",
          url: new URL(
            `${this.project}/_apis/wit/workItems/${failure.testCaseId}`,
            this.orgUrl
          ).toString(),
          attributes: { comment: "Linked from automated test failure." },
        },
      };
      patch.push(relationPatch);

      const runLink: JsonPatchOperation = {
        op: Operation.Add,
        path: "/relations/-",
        value: {
          rel: "Hyperlink",
          url: failure.runUrl,
          attributes: { comment: `Test Run ${failure.runId}` },
        },
      };
      patch.push(runLink);
    } catch (e) {
      this.logger.warn(
        `⚠️ Skipping relation link for ${failure.testName} due to URL issue:`,
        (e as Error).message
      );
    }

    const created = await this.workItemApi
      .createWorkItem(undefined, patch, this.project, this.defectType)
      .catch((err) => {
        this.logger.error(
          `❌ Failed to create ${this.defectType} for ${failure.testName}:`,
          err?.message || err
        );
        return null;
      });

    if (!created?.id) {
      this.logger.warn(
        `⚠️ Task was not created for ${failure.testName} (no id returned).`
      );
      return;
    }

    this.logger.log(`📌 Created ${this.defectType} ${created.id} for failed test ${failure.testName}`);
  }

  async resolveTaskForSuccess(testCaseId: string, buildNumber: string): Promise<void> {
    const existingTaskId = await this.findExistingTask(testCaseId);
    if (!existingTaskId) return;

    const comment = `Test passed in build ${escapeXml(buildNumber)}. Auto-closing defect.`;
    const patch: JsonPatchOperation[] = [
      {
        op: Operation.Add,
        path: "/fields/System.History",
        value: comment,
      },
      {
        op: Operation.Add,
        path: "/fields/System.State",
        value: "Closed",
      },
    ];

    try {
      await this.workItemApi.updateWorkItem(
        undefined,
        patch,
        existingTaskId,
        this.project
      );
      this.logger.log(
        `✅ Auto-closed ${this.defectType} ${existingTaskId} because TC ${testCaseId} passed.`
      );
    } catch (e) {
      this.logger.warn(
        `⚠️ Failed to auto-close ${this.defectType} ${existingTaskId}:`,
        (e as Error).message
      );
    }
  }
}
