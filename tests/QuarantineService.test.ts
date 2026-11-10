import * as fs from "fs";
import * as path from "path";
import { QuarantineService } from "../src/QuarantineService";
import { ILogger } from "../src/interfaces/ILogger";

class SilentLogger implements ILogger {
  log(_msg: string): void {}
  warn(_msg: string): void {}
  error(_msg: string): void {}
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function runTests() {
  const logger = new SilentLogger();
  const testConfigPath = path.resolve(process.cwd(), ".cache", "test-quarantine.json");

  // Ensure clean test file
  if (fs.existsSync(testConfigPath)) {
    fs.unlinkSync(testConfigPath);
  }

  console.log("1. Testing initialization and default config creation...");
  const service = new QuarantineService(logger, testConfigPath);
  const initial = service.load();
  assert(initial.version === 1, "Expected version 1");
  assert(Array.isArray(initial.quarantinedTests), "Expected quarantinedTests array");
  assert(initial.quarantinedTests.length === 0, "Expected empty initial quarantine list");
  console.log("   PASS: Initialization works properly.");

  console.log("2. Testing adding a test to quarantine...");
  const record1 = service.quarantineTest({
    testCaseId: "1015",
    testCaseTitle: "Checkout_PaymentGateway_Timeout_TC1015",
    reason: "Socket timeout in pipeline cluster",
    quarantinedBy: "qa.lead@example.com",
    healingThreshold: 3,
  });
  assert(record1.testCaseId === "1015", "Expected testCaseId 1015");
  assert(record1.status === "active", "Expected active status");
  assert(record1.healingThreshold === 3, "Expected threshold 3");
  assert(service.listActiveQuarantined().length === 1, "Expected 1 active quarantined test");
  console.log("   PASS: Adding quarantined test succeeds.");

  console.log("3. Testing isQuarantined matching by TC ID, TC prefix, and title substring...");
  assert(service.isQuarantined("1015"), "Failed matching by raw ID");
  assert(service.isQuarantined("TC1015"), "Failed matching with TC prefix");
  assert(service.isQuarantined(1015), "Failed matching by number");
  assert(service.isQuarantined(undefined, "test_Checkout_PaymentGateway_Timeout_TC1015"), "Failed matching by test name with TC id");
  assert(!service.isQuarantined("9999", "Healthy_Test_TC9999"), "Should not match unquarantined test");
  console.log("   PASS: ID and title matching work correctly.");

  console.log("4. Testing outcome streak tracking and graduation threshold...");
  // Pass 1
  const res1 = service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Passed");
  assert(res1.isQuarantined, "Expected isQuarantined = true");
  assert(res1.record?.consecutivePasses === 1, "Expected streak 1 after first pass");
  assert(!res1.isReadyForGraduation, "Streak 1 should not trigger graduation with threshold 3");

  // Pass 2
  const res2 = service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Passed");
  assert(res2.record?.consecutivePasses === 2, "Expected streak 2");
  assert(!res2.isReadyForGraduation, "Streak 2 should not trigger graduation with threshold 3");

  // Fail resets streak to 0
  const resFail = service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Failed");
  assert(resFail.record?.consecutivePasses === 0, "Streak should reset to 0 on failure");
  assert(!resFail.isReadyForGraduation, "Failed outcome cannot be ready for graduation");

  // Pass 1, 2, 3 -> Graduation ready!
  service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Passed");
  service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Passed");
  const resGradReady = service.recordExecutionOutcome("1015", "test_Checkout_PaymentGateway_Timeout_TC1015", "Passed");
  assert(resGradReady.record?.consecutivePasses === 3, "Expected streak 3");
  assert(resGradReady.isReadyForGraduation, "Expected isReadyForGraduation = true after 3 passes");

  const candidates = service.getGraduationCandidates();
  assert(candidates.length === 1, "Expected 1 graduation candidate");
  assert(candidates[0].test.testCaseId === "1015", "Expected candidate TC1015");
  console.log("   PASS: Streak increments, failure reset, and graduation threshold work.");

  console.log("5. Testing graduation approval...");
  const gradSuccess = service.graduateTest("1015", "Validated in 3 consecutive regression runs");
  assert(gradSuccess, "Graduation should return true");
  assert(!service.isQuarantined("1015"), "Graduated test should no longer be actively quarantined");
  assert(service.getGraduationCandidates().length === 0, "Candidate list should now be empty");
  console.log("   PASS: Graduation workflow succeeds.");

  console.log("6. Testing re-quarantine and manual removal...");
  service.quarantineTest({
    testCaseId: "2020",
    testCaseTitle: "Order_Inventory_Sync_TC2020",
    reason: "Intermittent database lock",
  });
  assert(service.isQuarantined("2020"), "TC2020 should be quarantined");
  const unquarantined = service.unquarantineTest("2020", "Database deadlock resolved by patch");
  assert(unquarantined, "Unquarantine should succeed");
  assert(!service.isQuarantined("2020"), "TC2020 should no longer be quarantined");
  console.log("   PASS: Re-quarantine and unquarantine work.");

  console.log("7. Testing Path Traversal protection on configPath...");
  let pathTraversalBlocked = false;
  try {
    new QuarantineService(logger, "../../../etc/passwd");
  } catch (e) {
    pathTraversalBlocked = true;
  }
  assert(pathTraversalBlocked, "Path traversal should be blocked");
  console.log("   PASS: Insecure config paths are rejected.");

  // Cleanup
  if (fs.existsSync(testConfigPath)) {
    fs.unlinkSync(testConfigPath);
  }

  console.log("🎉 All QuarantineService unit tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
