import * as http from "http";
import { NotificationService } from "../src/NotificationService";
import { AlertPayload } from "../src/interfaces/INotificationService";
import { ILogger } from "../src/interfaces/ILogger";
import { SecretRedactor } from "../src/utils/SecretRedactor";

const createMockLogger = (): ILogger => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const baseGreenPayload: AlertPayload = {
  project: "RetailApp",
  buildNumber: "2026.11.17.1",
  branch: "refs/heads/main",
  runId: 88,
  runUrl: "https://dev.azure.com/org/RetailApp/_testManagement/runs?runId=88",
  totalTests: 10,
  passedTests: 10,
  failedTests: 0,
  quarantinedTests: 0,
};

describe("NotificationService", () => {
  test("detectWebhookType auto-detects Slack, Teams, and generic JSON", () => {
    const svc = new NotificationService(createMockLogger());
    expect(svc.detectWebhookType("https://hooks.slack.com/services/T00/B00/XXX")).toBe("slack");
    expect(svc.detectWebhookType("https://outlook.webhook.office.com/webhookb2/123")).toBe("teams");
    expect(svc.detectWebhookType("https://prod-01.westus.logic.azure.com/workflows/123")).toBe("teams");
    expect(svc.detectWebhookType("https://example.com/hook")).toBe("json");
    expect(svc.detectWebhookType("https://example.com/hook", "slack")).toBe("slack");
  });

  test("validateWebhookUrl enforces https or localhost and registers secret", () => {
    const svc = new NotificationService(createMockLogger());
    const secretUrl = "https://hooks.slack.com/services/SECRET_PART/12345";
    expect(svc.validateWebhookUrl(secretUrl).hostname).toBe("hooks.slack.com");
    expect(SecretRedactor.redact(`Failed posting to ${secretUrl}`)).not.toContain("SECRET_PART");

    expect(svc.validateWebhookUrl("http://127.0.0.1:8080/hook").hostname).toBe("127.0.0.1");
    expect(() => svc.validateWebhookUrl("http://remote-host.example.com/hook")).toThrow(/Unsafe webhook URL/);
    expect(() => svc.validateWebhookUrl("file:///etc/passwd")).toThrow(/Unsafe webhook URL/);
  });

  test("shouldNotify skips green runs unless always=true and triggers on actionable events", () => {
    const svc = new NotificationService(createMockLogger());
    expect(svc.shouldNotify(baseGreenPayload, false)).toBe(false);
    expect(svc.shouldNotify(baseGreenPayload, true)).toBe(true);
    expect(svc.shouldNotify({ ...baseGreenPayload, failedTests: 1 })).toBe(true);
    expect(
      svc.shouldNotify({
        ...baseGreenPayload,
        newRegressions: [{ testName: "Checkout_TC101" }],
      })
    ).toBe(true);
    expect(
      svc.shouldNotify({
        ...baseGreenPayload,
        expiredQuarantines: [{ testKey: "TC_99", expiresAt: "2026-11-16T00:00:00Z" }],
      })
    ).toBe(true);
  });

  test("buildPayload constructs Slack Block Kit, Teams MessageCard, and JSON payloads", () => {
    const svc = new NotificationService(createMockLogger());
    const alert: AlertPayload = {
      ...baseGreenPayload,
      passedTests: 8,
      failedTests: 2,
      newRegressions: [{ testName: "Checkout_TC101", testCaseId: "101" }],
      expiredQuarantines: [{ testKey: "TC_99", expiresAt: "2026-11-16T00:00:00Z" }],
    };

    const slack = svc.buildPayload(alert, "slack");
    expect(slack.text).toContain("ALERT");
    expect(slack.blocks.length).toBeGreaterThanOrEqual(4);

    const teams = svc.buildPayload(alert, "teams");
    expect(teams["@type"]).toBe("MessageCard");
    expect(teams.themeColor).toBe("D13438");
    expect(teams.potentialAction[0].targets[0].uri).toBe(alert.runUrl);

    const json = svc.buildPayload(alert, "json");
    expect(json.event).toBe("ado_test_reporter_alert");
    expect(json.status).toBe("ALERT");
  });

  test("notify posts JSON over HTTP to local webhook and isolates errors", async () => {
    let receivedBody: any = null;
    let respondStatus = 200;

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(respondStatus, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: respondStatus === 200 }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as any;
    const url = `http://127.0.0.1:${addr.port}/webhook`;

    try {
      const logger = createMockLogger();
      const svc = new NotificationService(logger);

      // Green run skipped when always=false
      const skipped = await svc.notify(baseGreenPayload, { webhookUrl: url });
      expect(skipped).toBe(false);
      expect(receivedBody).toBeNull();

      // Actionable failure delivered
      const sent = await svc.notify(
        { ...baseGreenPayload, failedTests: 1, passedTests: 9 },
        { webhookUrl: url, webhookType: "slack" }
      );
      expect(sent).toBe(true);
      expect(receivedBody.blocks).toBeDefined();

      // HTTP 500 isolated by default
      respondStatus = 500;
      const isolated = await svc.notify(
        { ...baseGreenPayload, failedTests: 1 },
        { webhookUrl: url }
      );
      expect(isolated).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 500"));

      // Throws when failOnError=true
      await expect(
        svc.notify(
          { ...baseGreenPayload, failedTests: 1 },
          { webhookUrl: url, failOnError: true }
        )
      ).rejects.toThrow(/HTTP 500/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
