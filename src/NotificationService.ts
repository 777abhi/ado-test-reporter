import * as http from "http";
import * as https from "https";
import { ILogger } from "./interfaces/ILogger";
import {
  AlertPayload,
  INotificationService,
  NotificationOptions,
  WebhookType,
} from "./interfaces/INotificationService";
import { SecretRedactor } from "./utils/SecretRedactor";

export class NotificationService implements INotificationService {
  private readonly REQUEST_TIMEOUT_MS = 10000;

  constructor(private logger: ILogger) {}

  public shouldNotify(payload: AlertPayload, always: boolean = false): boolean {
    if (always) return true;
    if (payload.failedTests > 0) return true;
    if ((payload.newRegressions?.length ?? 0) > 0) return true;
    if ((payload.expiredQuarantines?.length ?? 0) > 0) return true;
    return false;
  }

  public detectWebhookType(url: string, explicitType?: WebhookType): "slack" | "teams" | "json" {
    if (explicitType && explicitType !== "auto") {
      return explicitType;
    }
    const lower = url.toLowerCase();
    if (lower.includes("hooks.slack.com")) {
      return "slack";
    }
    if (lower.includes("webhook.office.com") || lower.includes("logic.azure.com")) {
      return "teams";
    }
    return "json";
  }

  public validateWebhookUrl(rawUrl: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error("Invalid webhook URL.");
    }

    const isLocalhost =
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1";

    if (parsed.protocol === "https:") {
      SecretRedactor.registerSecret(rawUrl);
      return parsed;
    }

    if (parsed.protocol === "http:" && isLocalhost) {
      SecretRedactor.registerSecret(rawUrl);
      return parsed;
    }

    throw new Error(
      `Unsafe webhook URL protocol/host (${parsed.protocol}//${parsed.hostname}). Only https:// (or http://localhost for local testing) is allowed.`
    );
  }

  public buildPayload(
    payload: AlertPayload,
    type: "slack" | "teams" | "json"
  ): Record<string, any> {
    const regressions = payload.newRegressions || [];
    const expired = payload.expiredQuarantines || [];
    const hasIssues =
      payload.failedTests > 0 || regressions.length > 0 || expired.length > 0;
    const statusEmoji = hasIssues ? "🚨" : "✅";
    const statusLabel = hasIssues ? "ALERT" : "PASSED";
    const title = `${statusEmoji} ADO Test Reporter [${statusLabel}] — ${payload.project}${
      payload.buildNumber ? ` (Build ${payload.buildNumber})` : ""
    }`;

    if (type === "slack") {
      const blocks: any[] = [
        {
          type: "header",
          text: { type: "plain_text", text: title.slice(0, 150) },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Total:* ${payload.totalTests}` },
            { type: "mrkdwn", text: `*Passed:* ${payload.passedTests}` },
            { type: "mrkdwn", text: `*Failed:* ${payload.failedTests}` },
            { type: "mrkdwn", text: `*Quarantined:* ${payload.quarantinedTests}` },
          ],
        },
      ];

      if (regressions.length > 0) {
        const lines = regressions
          .slice(0, 10)
          .map((r) => `• \`${r.testName}\`${r.testCaseId ? ` (TC ${r.testCaseId})` : ""}`)
          .join("\n");
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*New PR Regressions (${regressions.length}):*\n${lines}`,
          },
        });
      }

      if (expired.length > 0) {
        const lines = expired
          .slice(0, 10)
          .map((e) => `• \`${e.testKey}\` (expired ${e.expiresAt})`)
          .join("\n");
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Expired Quarantines (${expired.length}):*\n${lines}`,
          },
        });
      }

      if (payload.runUrl) {
        blocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "View Test Run in ADO" },
              url: payload.runUrl,
            },
          ],
        });
      }

      return { text: title, blocks };
    }

    if (type === "teams") {
      const facts: { name: string; value: string }[] = [
        { name: "Project", value: payload.project },
        { name: "Total / Passed / Failed", value: `${payload.totalTests} / ${payload.passedTests} / ${payload.failedTests}` },
        { name: "Quarantined", value: String(payload.quarantinedTests) },
      ];
      if (payload.branch) facts.push({ name: "Branch", value: payload.branch });
      if (regressions.length > 0) {
        facts.push({
          name: `New PR Regressions (${regressions.length})`,
          value: regressions.slice(0, 10).map((r) => r.testName).join(", "),
        });
      }
      if (expired.length > 0) {
        facts.push({
          name: `Expired Quarantines (${expired.length})`,
          value: expired.slice(0, 10).map((e) => e.testKey).join(", "),
        });
      }

      const card: Record<string, any> = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        themeColor: hasIssues ? "D13438" : "107C10",
        summary: title,
        title,
        sections: [{ facts }],
      };

      if (payload.runUrl) {
        card.potentialAction = [
          {
            "@type": "OpenUri",
            name: "View Test Run in ADO",
            targets: [{ os: "default", uri: payload.runUrl }],
          },
        ];
      }

      return card;
    }

    return {
      event: "ado_test_reporter_alert",
      timestamp: new Date().toISOString(),
      status: statusLabel,
      ...payload,
    };
  }

  public async notify(payload: AlertPayload, options: NotificationOptions): Promise<boolean> {
    if (!options.webhookUrl) {
      return false;
    }

    if (!this.shouldNotify(payload, options.always)) {
      this.logger.log("ℹ️ Skipping webhook notification (no failures, regressions, or expired quarantines).");
      return false;
    }

    try {
      const parsedUrl = this.validateWebhookUrl(options.webhookUrl);
      const type = this.detectWebhookType(options.webhookUrl, options.webhookType);
      const body = JSON.stringify(this.buildPayload(payload, type));

      await this.postJson(parsedUrl, body);
      this.logger.log(`📣 Sent ${type.toUpperCase()} webhook notification.`);
      return true;
    } catch (err: any) {
      const msg = SecretRedactor.redact(err?.message || String(err));
      if (options.failOnError) {
        throw new Error(`Webhook notification failed: ${msg}`);
      }
      this.logger.warn(`⚠️ Webhook notification failed: ${msg}`);
      return false;
    }
  }

  private postJson(url: URL, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body, "utf8"),
          },
          timeout: this.REQUEST_TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const status = res.statusCode || 0;
            if (status >= 200 && status < 300) {
              resolve();
            } else {
              const respText = Buffer.concat(chunks).toString("utf8").slice(0, 200);
              reject(new Error(`HTTP ${status}: ${respText}`));
            }
          });
        }
      );

      req.on("timeout", () => {
        req.destroy(new Error(`Request timed out after ${this.REQUEST_TIMEOUT_MS}ms`));
      });
      req.on("error", (err) => reject(err));
      req.write(body);
      req.end();
    });
  }
}
