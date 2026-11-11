import * as fs from "fs";
import * as path from "path";
import { QuarantineService } from "../src/QuarantineService";
import { ConsoleLogger } from "../src/ConsoleLogger";

describe("QuarantineService Governance & TTL Controls", () => {
    const testDir = path.resolve(process.cwd(), "tests/temp_quarantine_governance");
    const configPath = path.join(testDir, "test-quarantine.json");
    let logger: ConsoleLogger;
    let service: QuarantineService;

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
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
        }
        logger = new ConsoleLogger();
        service = new QuarantineService(logger, configPath);
    });

    it("should store linkedWorkItemId, reasonCode, ttlDays, expiresAt, and audit history", () => {
        const record = service.quarantineTest({
            testCaseId: "1050",
            testCaseTitle: "Login_SSO_Failure_TC1050",
            reason: "Flaky third-party identity provider",
            reasonCode: "ENVIRONMENT_INSTABILITY",
            linkedWorkItemId: "AB#1050",
            ttlDays: 20,
            quarantinedBy: "security-auditor",
        });

        expect(record.testKey).toBe("TC1050");
        expect(record.linkedWorkItemId).toBe("AB#1050");
        expect(record.reasonCode).toBe("ENVIRONMENT_INSTABILITY");
        expect(record.ttlDays).toBe(20);
        expect(record.expiresAt).toBeDefined();

        expect(record.auditHistory).toBeDefined();
        expect(record.auditHistory).toHaveLength(1);
        expect(record.auditHistory![0].action).toBe("quarantined");
        expect(record.auditHistory![0].actor).toBe("security-auditor");
        expect(record.auditHistory![0].details).toContain("ENVIRONMENT_INSTABILITY");
    });

    it("should recognize when a test quarantine has expired and decline soft-pass", () => {
        // Create an already-expired quarantine record
        const config = service.load();
        const pastDate = new Date(Date.now() - 5 * 86400000).toISOString(); // 5 days ago
        config.quarantinedTests.push({
            testKey: "TC1099",
            testCaseId: "1099",
            testCaseTitle: "Legacy_Flaky_Test_TC1099",
            quarantinedAt: new Date(Date.now() - 35 * 86400000).toISOString(),
            expiresAt: pastDate,
            ttlDays: 30,
            reason: "Old failure",
            consecutivePasses: 0,
            healingThreshold: 5,
            status: "active",
        });
        service.save(config);

        // isQuarantined should return false because it's expired
        const isQuarantined = service.isQuarantined("1099", "Legacy_Flaky_Test_TC1099");
        expect(isQuarantined).toBe(false);
    });

    it("should transition expired tests to status 'expired' when checkExpirations is invoked", () => {
        const config = service.load();
        const pastDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
        config.quarantinedTests.push({
            testKey: "TC2000",
            testCaseId: "2000",
            testCaseTitle: "Expired_Test_TC2000",
            quarantinedAt: new Date(Date.now() - 20 * 86400000).toISOString(),
            expiresAt: pastDate,
            ttlDays: 14,
            reason: "Temporary skip",
            consecutivePasses: 0,
            healingThreshold: 5,
            status: "active",
        });
        service.save(config);

        const expired = service.checkExpirations();
        expect(expired).toHaveLength(1);
        expect(expired[0].testKey).toBe("TC2000");

        const reloaded = service.load();
        const testRecord = reloaded.quarantinedTests.find((t) => t.testKey === "TC2000");
        expect(testRecord?.status).toBe("expired");
        expect(testRecord?.auditHistory?.some((h) => h.action === "expired")).toBe(true);
    });

    it("should append audit history on unquarantine and graduation", () => {
        service.quarantineTest({
            testCaseId: "3000",
            testCaseTitle: "Test_3000",
            reason: "Investigation",
            quarantinedBy: "dev1",
        });

        service.unquarantineTest("3000", "Fixed in PR #123", "lead-qa");

        const reloaded = service.load();
        const record = reloaded.quarantinedTests.find((t) => t.testKey === "TC3000");
        expect(record?.status).toBe("removed");
        expect(record?.auditHistory).toHaveLength(2);
        expect(record?.auditHistory![1].action).toBe("unquarantined");
        expect(record?.auditHistory![1].actor).toBe("lead-qa");
    });
});
