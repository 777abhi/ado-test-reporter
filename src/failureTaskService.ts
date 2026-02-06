import { IFailureTaskService, FailureInfo } from "./interfaces/IFailureTaskService";
import { ILogger } from "./interfaces/ILogger";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import {
  JsonPatchOperation,
  Operation,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import { Wiql, WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { escapeWiqlString } from "./utils/WiqlUtils";
import { escapeXml } from "./utils/XmlUtils";
import * as crypto from 'crypto';

export class FailureTaskService implements IFailureTaskService {
  constructor(
    private workItemApi: IWorkItemTrackingApi,
    private project: string,
    private orgUrl: string,
    private logger: ILogger,
    private defectType: string = "Task"
  ) { }

  private generateErrorHash(message: string): string {
    return crypto.createHash('md5').update(message).digest('hex');
  }

  private async findTaskByErrorHash(hash: string): Promise<number | null> {
    const escapedDefectType = escapeWiqlString(this.defectType);
    const escapedHash = escapeWiqlString(hash);

    const wiql: Wiql = {
      query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE
          [System.TeamProject] = @project
          AND [System.WorkItemType] = '${escapedDefectType}'
          AND [System.Tags] CONTAINS 'ErrorHash:${escapedHash}'
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
        `⚠️ Failed to query existing task for ErrorHash ${hash}:`,
        (e as Error).message
      );
      return null;
    }
  }

  private async findTaskByLinkedTestCase(testCaseId: string): Promise<number | null> {
    const id = parseInt(testCaseId);
    if (isNaN(id)) return null;

    const escapedDefectType = escapeWiqlString(this.defectType);

    const wiql: Wiql = {
      query: `
        SELECT [System.Id]
        FROM WorkItemLinks
        WHERE
            ([Source].[System.TeamProject] = @project
            AND [Source].[System.WorkItemType] = '${escapedDefectType}'
            AND [Source].[System.State] <> 'Closed'
            AND [Source].[System.State] <> 'Done')
            AND ([System.Links.LinkType] = 'System.LinkTypes.Related')
            AND ([Target].[System.Id] = ${id})
        MODE (MustContain)
      `,
    };

    try {
      const result = await this.workItemApi.queryByWiql(wiql, {
        project: this.project,
      });

      if (result.workItemRelations && result.workItemRelations.length > 0) {
        for (const rel of result.workItemRelations) {
          if (rel.source && rel.target && rel.target.id === id) {
            return rel.source.id ?? null;
          }
        }
      }
      return null;
    } catch (e) {
      this.logger.warn(
        `⚠️ Failed to query existing task linked to TC ${testCaseId}:`,
        (e as Error).message
      );
      return null;
    }
  }

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
    let existingTaskId: number | null = null;
    let errorHash: string | null = null;

    if (failure.errorMessage) {
      errorHash = this.generateErrorHash(failure.errorMessage);
      existingTaskId = await this.findTaskByErrorHash(errorHash);
    }

    if (!existingTaskId && !failure.errorMessage) {
      existingTaskId = await this.findExistingTask(failure.testCaseId);
    }

    const comment = [
      `Test failed in build ${escapeXml(failure.buildNumber)}`,
      failure.errorMessage
        ? `Error: <pre>${escapeXml(failure.errorMessage)}</pre>`
        : "No error details.",
      `Run: ${escapeXml(failure.runUrl)}`,
    ].join("<br>");

    if (existingTaskId) {
      this.logger.log(
        `ℹ️ Task ${existingTaskId} already exists (Error Grouping or Legacy); updating.`
      );

      try {
        const task = await this.workItemApi.getWorkItem(
          existingTaskId,
          undefined,
          undefined,
          WorkItemExpand.Relations
        );

        const alreadyLinked = task.relations?.some((r) => {
          if (r.rel !== "System.LinkTypes.Related" || !r.url) return false;
          const match = r.url.match(/\/workItems\/(\d+)$/i);
          return match ? match[1] === failure.testCaseId : false;
        });

        if (!alreadyLinked) {
          const expectedUrl = new URL(
            `${this.project}/_apis/wit/workItems/${failure.testCaseId}`,
            this.orgUrl
          ).toString();

          const patch: JsonPatchOperation[] = [
            {
              op: Operation.Add,
              path: "/relations/-",
              value: {
                rel: "System.LinkTypes.Related",
                url: expectedUrl,
                attributes: { comment: "Linked from automated test failure." },
              },
            },
          ];
          await this.workItemApi.updateWorkItem(
            undefined,
            patch,
            existingTaskId,
            this.project
          );
          this.logger.log(`🔗 Linked TC ${failure.testCaseId} to Task ${existingTaskId}`);
        }
      } catch (e) {
        this.logger.warn(
          `⚠️ Failed to check/link TC to Task ${existingTaskId}: ${(e as Error).message}`
        );
      }

      await this.addComment(existingTaskId, comment);
      return;
    }

    let title = `[Auto] Investigate: ${failure.testName} (TC ${failure.testCaseId})`;
    let tags = "AutomatedTestFailure";

    if (failure.errorMessage && errorHash) {
      const shortError = failure.errorMessage.split('\n')[0].substring(0, 100);
      title = `[Auto] Failure: ${shortError}`;
      tags += `; ErrorHash:${errorHash}`;
    }

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
      { op: Operation.Add, path: "/fields/System.Tags", value: tags },
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
    const existingTaskId = await this.findTaskByLinkedTestCase(testCaseId);
    if (!existingTaskId) return;

    try {
      const task = await this.workItemApi.getWorkItem(
        existingTaskId,
        undefined,
        undefined,
        WorkItemExpand.Relations
      );

      if (!task || !task.relations) return;

      const relIndex = task.relations.findIndex((r) => {
        if (r.rel !== "System.LinkTypes.Related" || !r.url) return false;
        const match = r.url.match(/\/workItems\/(\d+)$/i);
        return match ? match[1] === testCaseId : false;
      });

      if (relIndex === -1) return;

      const relatedTCCount = task.relations.filter((r) => {
        if (r.rel !== "System.LinkTypes.Related" || !r.url) return false;
        return /\/workItems\/\d+$/i.test(r.url);
      }).length;

      const patch: JsonPatchOperation[] = [
        {
          op: Operation.Remove,
          path: `/relations/${relIndex}`,
        },
      ];

      const shouldClose = relatedTCCount <= 1;

      if (shouldClose) {
        const comment = `Test passed in build ${escapeXml(buildNumber)}. Auto-closing defect.`;
        patch.push({
          op: Operation.Add,
          path: "/fields/System.History",
          value: comment,
        });
        patch.push({
          op: Operation.Add,
          path: "/fields/System.State",
          value: "Closed",
        });
      } else {
        const comment = `Test Case ${testCaseId} passed in build ${escapeXml(buildNumber)}. Removed link. Task remains open for other failures.`;
        patch.push({
          op: Operation.Add,
          path: "/fields/System.History",
          value: comment,
        });
      }

      await this.workItemApi.updateWorkItem(
        undefined,
        patch,
        existingTaskId,
        this.project
      );

      if (shouldClose) {
        this.logger.log(
          `✅ Auto-closed ${this.defectType} ${existingTaskId} because TC ${testCaseId} passed (last link).`
        );
      } else {
        this.logger.log(
          `ℹ️ Removed link to TC ${testCaseId} from ${this.defectType} ${existingTaskId}.`
        );
      }
    } catch (e) {
      this.logger.warn(
        `⚠️ Failed to resolve ${this.defectType} ${existingTaskId}:`,
        (e as Error).message
      );
    }
  }
}
