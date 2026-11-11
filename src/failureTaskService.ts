import * as fs from "fs";
import * as path from "path";
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
import { sanitizeForCsv } from "./utils/CsvUtils";
import { isSafePath } from "./utils/PathUtils";
import * as crypto from 'crypto';
import { ExecutionProvenance } from "./interfaces/IAuditManifest";

export class FailureTaskService implements IFailureTaskService {
  constructor(
    private workItemApi: IWorkItemTrackingApi,
    private project: string,
    private orgUrl: string,
    private logger: ILogger,
    private defectType: string = "Task",
    private autoCloseAllowedBranches: string[] = [
      "main",
      "master",
      "refs/heads/main",
      "refs/heads/master",
      "release/*",
    ],
    private autoCloseTargetState: string = "Resolved",
    private currentBranch: string = "local"
  ) { }

  private isBranchAllowedForAutoClose(branch: string): boolean {
    if (!this.autoCloseAllowedBranches || this.autoCloseAllowedBranches.length === 0) return true;
    const cleanBranch = branch.trim();
    return this.autoCloseAllowedBranches.some((pattern) => {
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1);
        return cleanBranch.startsWith(prefix) || cleanBranch.replace(/^refs\/heads\//, "").startsWith(prefix);
      }
      return (
        cleanBranch === pattern ||
        cleanBranch === `refs/heads/${pattern}` ||
        cleanBranch.replace(/^refs\/heads\//, "") === pattern
      );
    });
  }

  private generateErrorHash(message: string): string {
    return crypto.createHash('sha256').update(message).digest('hex');
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

  private async attachFiles(workItemId: number, attachments?: string[]): Promise<void> {
    if (!attachments || attachments.length === 0) return;

    for (const attachPath of attachments) {
      try {
        if (!isSafePath(attachPath)) {
           this.logger.warn(`⚠️ Security Risk: Attachment path '${attachPath}' traverses outside the working directory (or symlinked outside). Skipping.`);
           continue;
        }

        if (fs.existsSync(attachPath)) {
          const stream = fs.createReadStream(attachPath);
          const fileName = path.basename(attachPath);

          const attachment = await this.workItemApi.createAttachment(
            undefined,
            stream,
            fileName,
            undefined,
            this.project
          );

          if (attachment.url) {
             const patch: JsonPatchOperation[] = [
                {
                    op: Operation.Add,
                    path: "/relations/-",
                    value: {
                        rel: "AttachedFile",
                        url: attachment.url,
                        attributes: {
                            comment: "Attached by ADO Test Reporter"
                        }
                    }
                }
            ];
            await this.workItemApi.updateWorkItem(undefined, patch, workItemId, this.project);
            this.logger.log(`📎 Linked attachment to task ${workItemId}: ${attachPath}`);
          }
        } else {
             this.logger.warn(`⚠️ Attachment not found: ${attachPath}`);
        }
      } catch (e) {
          this.logger.warn(`⚠️ Failed to attach ${attachPath} to task ${workItemId}: ${(e as Error).message}`);
      }
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
      await this.attachFiles(existingTaskId, failure.attachments);
      return;
    }

    // Sentinel: Truncate and sanitize inputs for System.Title
    const MAX_NAME_LEN = 200;
    let safeName = failure.testName;
    if (safeName.length > MAX_NAME_LEN) {
        safeName = safeName.substring(0, MAX_NAME_LEN) + "...";
    }
    safeName = sanitizeForCsv(safeName);

    let titlePrefix = failure.isFlaky ? "[Auto] Flaky:" : "[Auto] Investigate:";
    let title = `${titlePrefix} ${safeName} (TC ${failure.testCaseId})`;
    let tags = "AutomatedTestFailure";

    if (failure.isFlaky) {
        tags += "; Flaky";
    }

    if (failure.errorMessage && errorHash) {
      let shortError = failure.errorMessage.split('\n')[0].substring(0, 100);
      shortError = sanitizeForCsv(shortError);
      titlePrefix = failure.isFlaky ? "[Auto] Flaky:" : "[Auto] Failure:";
      title = `${titlePrefix} ${shortError}`;
      tags += `; ErrorHash:${errorHash}`;
    }

    let provenanceHtml = "";
    if (failure.provenance) {
      const p = failure.provenance;
      provenanceHtml = [
        `<hr/>`,
        `<p><b>🛡️ Audit Traceability & Provenance:</b></p>`,
        `<ul>`,
        `  <li><b>Commit SHA:</b> <code>${escapeXml(p.commitSha)}</code></li>`,
        `  <li><b>Branch:</b> <code>${escapeXml(p.branch)}</code></li>`,
        `  <li><b>Triggered By:</b> <code>${escapeXml(p.triggerActor)}</code></li>`,
        `  <li><b>Agent:</b> <code>${escapeXml(p.agentName)}</code></li>`,
        `  <li><b>Timestamp:</b> <code>${escapeXml(p.timestamp)}</code></li>`,
        `</ul>`,
      ].join("\n");
      if (p.commitSha && p.commitSha !== "local-head") {
        tags += `; Commit:${p.commitSha.substring(0, 8)}`;
      }
      if (p.branch) {
        tags += `; Branch:${p.branch.replace(/^refs\/heads\//, "")}`;
      }
    }

    // Sentinel: Sanitize inputs to prevent Stored XSS in Work Item description
    const description = [
      `<p>Test failed in build <b>${escapeXml(failure.buildNumber)}</b></p>`,
      `<p>Test Case ID: ${escapeXml(failure.testCaseId)}</p>`,
      failure.errorMessage
        ? `<pre>${escapeXml(failure.errorMessage)}</pre>`
        : "<p>No error message provided.</p>",
      provenanceHtml,
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
    await this.attachFiles(created.id, failure.attachments);
  }

  async resolveTaskForSuccess(
    testCaseId: string,
    buildNumber: string,
    provenance?: ExecutionProvenance
  ): Promise<void> {
    const existingTaskId = await this.findTaskByLinkedTestCase(testCaseId);
    if (!existingTaskId) return;

    const effectiveBranch = provenance?.branch || this.currentBranch;
    const isAllowed = this.isBranchAllowedForAutoClose(effectiveBranch);

    if (!isAllowed) {
      this.logger.log(
        `🛡️ Governance Check: Skipping auto-close for ${this.defectType} ${existingTaskId} (TC ${testCaseId}). Branch '${effectiveBranch}' is not an authorized release branch.`
      );
      await this.addComment(
        existingTaskId,
        `[AUDIT] Test Case ${testCaseId} passed in build ${escapeXml(buildNumber)} on non-release branch <code>${escapeXml(effectiveBranch)}</code>. Defect auto-closure is disabled by governance policy on non-release branches.`
      );
      return;
    }

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
        const targetState = this.autoCloseTargetState || "Resolved";
        const provenanceInfo = provenance
          ? ` (Commit: ${escapeXml(provenance.commitSha)}, Branch: ${escapeXml(effectiveBranch)}, Actor: ${escapeXml(provenance.triggerActor)})`
          : "";
        const comment = `[AUDIT] Auto-resolved by ADO Test Reporter. Verification passed in build ${escapeXml(buildNumber)}${provenanceInfo}. State transitioned to ${targetState}.`;
        patch.push({
          op: Operation.Add,
          path: "/fields/System.History",
          value: comment,
        });
        patch.push({
          op: Operation.Add,
          path: "/fields/System.State",
          value: targetState,
        });
      } else {
        const comment = `[AUDIT] Test Case ${testCaseId} passed in build ${escapeXml(buildNumber)} on branch ${escapeXml(effectiveBranch)}. Removed link. Task remains open for other failures.`;
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
          `✅ Auto-closed ${this.defectType} ${existingTaskId} (state: ${this.autoCloseTargetState}) because TC ${testCaseId} passed on branch '${effectiveBranch}'.`
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
