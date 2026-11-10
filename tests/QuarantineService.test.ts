import * as fs from "fs";
import * as path from "path";
import { QuarantineService } from "../src/QuarantineService";
import { ILogger } from "../src/interfaces/ILogger";

class SilentLogger implements ILogger {
  log(_msg: string): void {}
  warn(_msg: string): void {}
  error(_msg: string): void {}
}

describe("QuarantineService", () => {
  const logger = new SilentLogger();
  const testConfigPath = path.resolve(process.cwd(), ".cache", "test-quarantine.json");

  beforeEach(() => {
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  it("should initialize and create default config file", () => {
    const service = new QuarantineService(logger, testConfigPath);
    const initial = service.load();
    expect(initial.version).toBe(1);
    expect(Array.isArray(initial.quarantinedTests)).toBe(true);
    expect(initial.quarantinedTests.length).toBe(0);
  });

  it("should add a test to quarantine", () => {
    const service = new QuarantineService(logger, testConfigPath);
    const record = service.quarantineTest({
      testCaseId: "1015",
      testCaseTitle: "Checkout_PaymentGateway_Timeout_TC1015",
      reason: "Socket timeout in pipeline cluster",
      quarantinedBy: "qa.lead@example.com",
      healingThreshold: 3,
    });
    expect(record.testCaseId).toBe("1015");
    expect(record.status).toBe("active");
    expect(record.healingThreshold).toBe(3);
    expect(service.listActiveQuarantined().length).toBe(1);
  });

  it("should match quarantined tests by TC ID, TC prefix, number, and title substring", () => {
    const service = new QuarantineService(logger, testConfigPath);
    service.quarantineTest({
      testCaseId: "1015",
      testCaseTitle: "Checkout_PaymentGateway_Timeout_TC1015",
      reason: "Timeout",
    });

    expect(service.isQuarantined("1015")).toBe(true);
    expect(service.isQuarantined("TC1015")).toBe(true);
    expect(service.isQuarantined(1015)).toBe(true);
    expect(service.isQuarantined(undefined, "test_Checkout_PaymentGateway_Timeout_TC1015")).toBe(true);
    expect(service.isQuarantined("9999", "Healthy_Test_TC9999")).toBe(false);
  });

  it("should track outcome streaks, reset streak on failure, and detect graduation threshold", () => {
    const service = new QuarantineService(logger, testConfigPath);
    service.quarantineTest({
      testCaseId: "1015",
      testCaseTitle: "Checkout_PaymentGateway_Timeout_TC1015",
      reason: "Streak test",
      healingThreshold: 3,
    });

    const res1 = service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Passed");
    expect(res1.isQuarantined).toBe(true);
    expect(res1.record?.consecutivePasses).toBe(1);
    expect(res1.isReadyForGraduation).toBe(false);

    const res2 = service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Passed");
    expect(res2.record?.consecutivePasses).toBe(2);
    expect(res2.isReadyForGraduation).toBe(false);

    // Fail resets streak to 0
    const resFail = service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Failed");
    expect(resFail.record?.consecutivePasses).toBe(0);
    expect(resFail.isReadyForGraduation).toBe(false);

    // Pass 1, 2, 3 -> Graduation ready
    service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Passed");
    service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Passed");
    const resGradReady = service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Passed");
    expect(resGradReady.record?.consecutivePasses).toBe(3);
    expect(resGradReady.isReadyForGraduation).toBe(true);

    const candidates = service.getGraduationCandidates();
    expect(candidates.length).toBe(1);
    expect(candidates[0].test.testCaseId).toBe("1015");
  });

  it("should graduate test upon approval", () => {
    const service = new QuarantineService(logger, testConfigPath);
    service.quarantineTest({
      testCaseId: "1015",
      testCaseTitle: "Checkout_PaymentGateway_Timeout_TC1015",
      reason: "Graduation test",
      healingThreshold: 1,
    });
    service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Passed");

    const gradSuccess = service.graduateTest("1015", "Validated in 3 consecutive regression runs");
    expect(gradSuccess).toBe(true);
    expect(service.isQuarantined("1015")).toBe(false);
    expect(service.getGraduationCandidates().length).toBe(0);
  });

  it("should handle re-quarantine and manual removal (unquarantine)", () => {
    const service = new QuarantineService(logger, testConfigPath);
    service.quarantineTest({
      testCaseId: "2020",
      testCaseTitle: "Order_Inventory_Sync_TC2020",
      reason: "Intermittent database lock",
    });
    expect(service.isQuarantined("2020")).toBe(true);

    const unquarantined = service.unquarantineTest("2020", "Database deadlock resolved by patch");
    expect(unquarantined).toBe(true);
    expect(service.isQuarantined("2020")).toBe(false);
  });

  it("should prevent path traversal on configPath", () => {
    expect(() => {
      new QuarantineService(logger, "../../../etc/passwd");
    }).toThrow();
  });
});
