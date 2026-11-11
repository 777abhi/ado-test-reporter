import * as fs from "fs";
import * as path from "path";
import { AuditLogger } from "../src/AuditLogger";
import { SecretRedactor } from "../src/utils/SecretRedactor";

describe("AuditLogger", () => {
    const testDir = path.resolve(process.cwd(), "tests/temp_audit_logger");
    const testLogFile = path.join(testDir, "audit-events.ndjson");

    beforeAll(() => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
    });

    afterAll(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    beforeEach(() => {
        SecretRedactor.clearDynamicSecrets();
        if (fs.existsSync(testLogFile)) {
            fs.unlinkSync(testLogFile);
        }
    });

    it("should log structured audit events to memory and file", () => {
        const logger = new AuditLogger(testLogFile);

        logger.logAudit({
            eventType: "TEST_EXECUTION",
            level: "INFO",
            action: "Publishing test run",
            actor: "ci-agent",
            buildId: 101,
            targetId: "Run-101",
            status: "SUCCESS",
            details: { testCount: 25 },
        });

        const events = logger.getAuditEvents();
        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe("TEST_EXECUTION");
        expect(events[0].actor).toBe("ci-agent");
        expect(events[0].timestamp).toBeDefined();

        expect(fs.existsSync(testLogFile)).toBe(true);
        const fileContent = fs.readFileSync(testLogFile, "utf8").trim();
        const parsed = JSON.parse(fileContent);
        expect(parsed.action).toBe("Publishing test run");
        expect(parsed.details.testCount).toBe(25);
    });

    it("should automatically redact dynamically registered secrets inside audit event details", () => {
        const secretVal = "super_classified_token_999";
        SecretRedactor.registerSecret(secretVal);

        const logger = new AuditLogger(testLogFile);
        logger.logAudit({
            eventType: "SECURITY_TEST",
            level: "SECURITY",
            action: "Connecting with credentials",
            actor: "dev-lead",
            details: {
                token: secretVal,
                url: `https://dev.azure.com/org?token=${secretVal}`,
            },
        });

        const events = logger.getAuditEvents();
        expect(events[0].details?.token).toBe("***REDACTED***");
        expect(events[0].details?.url).toBe("https://dev.azure.com/org?token=***REDACTED***");
    });
});
