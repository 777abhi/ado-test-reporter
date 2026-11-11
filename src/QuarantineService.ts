import * as fs from "fs";
import * as path from "path";
import {
  GraduationCandidate,
  IQuarantineService,
  QuarantineAddOptions,
  QuarantineConfigFile,
  QuarantineOutcomeResult,
  QuarantinedTestRecord,
} from "./interfaces/IQuarantineService";
import { ILogger } from "./interfaces/ILogger";
import { isSafePath } from "./utils/PathUtils";

const TC_ID_REGEX = /TC(\d+)/i;
const DEFAULT_HEALING_THRESHOLD = 5;
const DEFAULT_TTL_DAYS = 14;

export class QuarantineService implements IQuarantineService {
  private configFilePath: string;

  constructor(
    private logger: ILogger,
    configPath: string = "quarantine.json",
    private rootDir: string = process.cwd()
  ) {
    const resolved = path.isAbsolute(configPath)
      ? configPath
      : path.resolve(this.rootDir, configPath);

    if (!isSafePath(resolved, this.rootDir)) {
      throw new Error(`Insecure quarantine config path detected: ${configPath}`);
    }
    this.configFilePath = resolved;
  }

  getConfigFilePath(): string {
    return this.configFilePath;
  }

  load(): QuarantineConfigFile {
    try {
      if (!fs.existsSync(this.configFilePath)) {
        return {
          version: 1,
          lastUpdated: new Date().toISOString(),
          quarantinedTests: [],
        };
      }
      const raw = fs.readFileSync(this.configFilePath, "utf8");
      if (!raw.trim()) {
        return {
          version: 1,
          lastUpdated: new Date().toISOString(),
          quarantinedTests: [],
        };
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.quarantinedTests)) {
        this.logger.warn(`⚠️ Quarantine config format invalid at ${this.configFilePath}. Initializing empty.`);
        return {
          version: 1,
          lastUpdated: new Date().toISOString(),
          quarantinedTests: [],
        };
      }
      return parsed as QuarantineConfigFile;
    } catch (e) {
      this.logger.warn(`⚠️ Failed to parse quarantine file ${this.configFilePath}: ${(e as Error).message}`);
      return {
        version: 1,
        lastUpdated: new Date().toISOString(),
        quarantinedTests: [],
      };
    }
  }

  save(config: QuarantineConfigFile): void {
    try {
      const dir = path.dirname(this.configFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      config.lastUpdated = new Date().toISOString();
      const content = JSON.stringify(config, null, 2);
      fs.writeFileSync(this.configFilePath, content, "utf8");
    } catch (e) {
      this.logger.error(`❌ Failed to write quarantine config to ${this.configFilePath}: ${(e as Error).message}`);
      throw e;
    }
  }

  static normalizeTestCaseId(tcId?: string | number): string | undefined {
    if (tcId === undefined || tcId === null) return undefined;
    const str = String(tcId).trim();
    const match = str.match(TC_ID_REGEX);
    if (match) {
      return match[1];
    }
    const digitsOnly = str.match(/^\d+$/);
    if (digitsOnly) {
      return digitsOnly[0];
    }
    return str;
  }

  isQuarantined(testCaseId?: string | number, testName?: string, checkExpiry: boolean = true): boolean {
    const record = this.getQuarantinedTest(testCaseId, testName);
    if (!record || record.status !== "active") return false;

    if (checkExpiry && record.expiresAt) {
      const now = new Date();
      const expiresAt = new Date(record.expiresAt);
      if (now > expiresAt) {
        this.logger.warn(
          `⚠️ [QUARANTINE_EXPIRED] Test '${record.testCaseTitle}' [${record.testKey}] quarantine expired on ${record.expiresAt} (TTL exceeded).`
        );
        return false;
      }
    }

    return true;
  }

  getQuarantinedTest(
    testCaseId?: string | number,
    testName?: string
  ): QuarantinedTestRecord | undefined {
    const config = this.load();
    const normalizedInputId = QuarantineService.normalizeTestCaseId(testCaseId);
    const normalizedName = (testName || "").trim().toLowerCase();

    // Check if testName contains a TC ID
    let extractedNameTcId: string | undefined;
    if (testName) {
      const match = testName.match(TC_ID_REGEX);
      if (match) {
        extractedNameTcId = match[1];
      }
    }

    return config.quarantinedTests.find((t) => {
      if (t.status !== "active") return false;

      // 1. Match by normalized testCaseId
      const targetId = QuarantineService.normalizeTestCaseId(t.testCaseId);
      if (normalizedInputId && targetId && normalizedInputId === targetId) {
        return true;
      }
      if (extractedNameTcId && targetId && extractedNameTcId === targetId) {
        return true;
      }

      // 2. Match by testKey
      if (testName && t.testKey && t.testKey.toLowerCase() === normalizedName) {
        return true;
      }
      if (normalizedInputId && t.testKey === normalizedInputId) {
        return true;
      }

      // 3. Match by testCaseTitle
      if (
        testName &&
        t.testCaseTitle &&
        (t.testCaseTitle.toLowerCase() === normalizedName ||
          normalizedName.includes(t.testCaseTitle.toLowerCase()))
      ) {
        return true;
      }

      return false;
    });
  }

  quarantineTest(options: QuarantineAddOptions): QuarantinedTestRecord {
    const config = this.load();
    const normalizedId = QuarantineService.normalizeTestCaseId(options.testCaseId);
    const testKey =
      options.testKey ||
      (normalizedId ? `TC${normalizedId}` : options.testCaseTitle.replace(/\s+/g, "_"));

    const existingIndex = config.quarantinedTests.findIndex((t) => {
      const existingId = QuarantineService.normalizeTestCaseId(t.testCaseId);
      if (normalizedId && existingId && normalizedId === existingId) return true;
      return t.testKey.toLowerCase() === testKey.toLowerCase();
    });

    const now = new Date().toISOString();
    const healingThreshold = options.healingThreshold ?? DEFAULT_HEALING_THRESHOLD;
    const ttlDays = options.ttlDays ?? DEFAULT_TTL_DAYS;
    const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();
    const reasonCode = options.reasonCode || "UNSPECIFIED";
    const linkedWorkItemId = options.linkedWorkItemId;

    if (existingIndex >= 0) {
      const existing = config.quarantinedTests[existingIndex];
      existing.status = "active";
      existing.reason = options.reason || existing.reason;
      existing.reasonCode = reasonCode || existing.reasonCode;
      existing.linkedWorkItemId = linkedWorkItemId || existing.linkedWorkItemId;
      existing.quarantinedBy = options.quarantinedBy || existing.quarantinedBy;
      existing.healingThreshold = healingThreshold;
      existing.ttlDays = ttlDays;
      existing.expiresAt = expiresAt;
      existing.lastObservedAt = now;
      if (options.notes) existing.notes = options.notes;

      if (!existing.auditHistory) existing.auditHistory = [];
      existing.auditHistory.push({
        action: "re_quarantined",
        timestamp: now,
        actor: options.quarantinedBy,
        details: `Re-quarantined for ${ttlDays}d (Reason: ${reasonCode}). Linked Defect: ${linkedWorkItemId || "none"}`,
      });

      this.save(config);
      this.logger.log(`🛡️ Test '${existing.testCaseTitle}' [${existing.testKey}] re-quarantined successfully (Expires: ${expiresAt}).`);
      return existing;
    }

    const record: QuarantinedTestRecord = {
      testKey,
      testCaseId: normalizedId,
      testCaseTitle: options.testCaseTitle,
      quarantinedAt: now,
      quarantinedBy: options.quarantinedBy || "unknown",
      reason: options.reason,
      reasonCode,
      linkedWorkItemId,
      ttlDays,
      expiresAt,
      consecutivePasses: 0,
      healingThreshold,
      status: "active",
      notes: options.notes,
      auditHistory: [
        {
          action: "quarantined",
          timestamp: now,
          actor: options.quarantinedBy,
          details: `Quarantined for ${ttlDays}d (Reason: ${reasonCode}). Linked Defect: ${linkedWorkItemId || "none"}`,
        },
      ],
    };

    config.quarantinedTests.push(record);
    this.save(config);
    this.logger.log(`🛡️ Test '${record.testCaseTitle}' [${record.testKey}] added to quarantine (Expires: ${expiresAt}).`);
    return record;
  }

  unquarantineTest(testKeyOrId: string, reason?: string, actor?: string): boolean {
    const config = this.load();
    const normalizedInputId = QuarantineService.normalizeTestCaseId(testKeyOrId);
    const lowerKey = testKeyOrId.trim().toLowerCase();

    const target = config.quarantinedTests.find((t) => {
      const targetId = QuarantineService.normalizeTestCaseId(t.testCaseId);
      if (normalizedInputId && targetId && normalizedInputId === targetId) return true;
      return t.testKey.toLowerCase() === lowerKey;
    });

    if (!target) {
      this.logger.warn(`⚠️ No quarantined test matching '${testKeyOrId}' found to remove.`);
      return false;
    }

    target.status = "removed";
    if (reason) {
      target.notes = target.notes ? `${target.notes} | Unquarantine: ${reason}` : `Unquarantine: ${reason}`;
    }
    if (!target.auditHistory) target.auditHistory = [];
    target.auditHistory.push({
      action: "unquarantined",
      timestamp: new Date().toISOString(),
      actor,
      details: reason || "Manual unquarantine",
    });

    this.save(config);
    this.logger.log(`✅ Test '${target.testCaseTitle}' [${target.testKey}] removed from quarantine.`);
    return true;
  }

  graduateTest(testKeyOrId: string, notes?: string, actor?: string): boolean {
    const config = this.load();
    const normalizedInputId = QuarantineService.normalizeTestCaseId(testKeyOrId);
    const lowerKey = testKeyOrId.trim().toLowerCase();

    const target = config.quarantinedTests.find((t) => {
      const targetId = QuarantineService.normalizeTestCaseId(t.testCaseId);
      if (normalizedInputId && targetId && normalizedInputId === targetId) return true;
      return t.testKey.toLowerCase() === lowerKey;
    });

    if (!target) {
      this.logger.warn(`⚠️ No quarantined test matching '${testKeyOrId}' found for graduation.`);
      return false;
    }

    const now = new Date().toISOString();
    target.status = "graduated";
    target.graduatedAt = now;
    if (notes) {
      target.notes = target.notes ? `${target.notes} | Graduation: ${notes}` : `Graduation: ${notes}`;
    }
    if (!target.auditHistory) target.auditHistory = [];
    target.auditHistory.push({
      action: "graduated",
      timestamp: now,
      actor,
      details: `Graduated after ${target.consecutivePasses} consecutive passes. ${notes || ""}`.trim(),
    });

    this.save(config);
    this.logger.log(`🎓 Test '${target.testCaseTitle}' [${target.testKey}] graduated from quarantine with ${target.consecutivePasses} passes!`);
    return true;
  }

  recordExecutionOutcome(
    testCaseId: string | number | undefined,
    testName: string,
    outcome: string
  ): QuarantineOutcomeResult {
    const config = this.load();
    const record = this.findMatchingRecord(config.quarantinedTests, testCaseId, testName);

    if (!record || record.status !== "active") {
      return {
        record: undefined,
        isQuarantined: false,
        isReadyForGraduation: false,
      };
    }

    const now = new Date();
    const isExpired = Boolean(record.expiresAt && now > new Date(record.expiresAt));

    if (isExpired) {
      this.logger.warn(
        `⚠️ [QUARANTINE_EXPIRED] Test '${record.testCaseTitle}' [${record.testKey}] quarantine expired on ${record.expiresAt} (TTL exceeded).`
      );
      record.status = "expired";
      if (!record.auditHistory) record.auditHistory = [];
      record.auditHistory.push({
        action: "expired",
        timestamp: now.toISOString(),
        details: `Quarantine expired on ${record.expiresAt} during execution outcome check.`,
      });
      this.save(config);
      return {
        record,
        isQuarantined: false,
        isReadyForGraduation: false,
        isExpired: true,
      };
    }

    const nowIso = now.toISOString();
    const lowerOutcome = (outcome || "").trim().toLowerCase();
    record.lastObservedAt = nowIso;
    record.lastOutcome = outcome;

    if (lowerOutcome === "passed") {
      record.consecutivePasses = (record.consecutivePasses || 0) + 1;
    } else if (lowerOutcome === "failed" || lowerOutcome === "blocked") {
      record.consecutivePasses = 0;
    }

    const isReadyForGraduation = record.consecutivePasses >= record.healingThreshold;
    this.save(config);

    if (isReadyForGraduation) {
      this.logger.log(
        `🎉 Quarantined test '${record.testCaseTitle}' reached healing streak: ${record.consecutivePasses}/${record.healingThreshold} passes! Ready for graduation.`
      );
    }

    return {
      record,
      isQuarantined: true,
      isReadyForGraduation,
      isExpired: false,
    };
  }

  checkExpirations(): QuarantinedTestRecord[] {
    const config = this.load();
    const now = new Date();
    const expiredRecords: QuarantinedTestRecord[] = [];

    for (const record of config.quarantinedTests) {
      if (record.status === "active" && record.expiresAt) {
        if (now > new Date(record.expiresAt)) {
          record.status = "expired";
          if (!record.auditHistory) record.auditHistory = [];
          record.auditHistory.push({
            action: "expired",
            timestamp: now.toISOString(),
            details: `Quarantine TTL exceeded. Expired at ${record.expiresAt}.`,
          });
          expiredRecords.push(record);
          this.logger.warn(
            `⚠️ [QUARANTINE_EXPIRED] Test '${record.testCaseTitle}' [${record.testKey}] quarantine expired on ${record.expiresAt}. Status transitioned to expired.`
          );
        }
      }
    }

    if (expiredRecords.length > 0) {
      this.save(config);
    }
    return expiredRecords;
  }

  private findMatchingRecord(
    records: QuarantinedTestRecord[],
    testCaseId?: string | number,
    testName?: string
  ): QuarantinedTestRecord | undefined {
    const normalizedInputId = QuarantineService.normalizeTestCaseId(testCaseId);
    const normalizedName = (testName || "").trim().toLowerCase();

    let extractedNameTcId: string | undefined;
    if (testName) {
      const match = testName.match(TC_ID_REGEX);
      if (match) {
        extractedNameTcId = match[1];
      }
    }

    return records.find((t) => {
      const targetId = QuarantineService.normalizeTestCaseId(t.testCaseId);
      if (normalizedInputId && targetId && normalizedInputId === targetId) return true;
      if (extractedNameTcId && targetId && extractedNameTcId === targetId) return true;
      if (testName && t.testKey.toLowerCase() === normalizedName) return true;
      if (
        testName &&
        t.testCaseTitle &&
        (t.testCaseTitle.toLowerCase() === normalizedName ||
          normalizedName.includes(t.testCaseTitle.toLowerCase()))
      ) {
        return true;
      }
      return false;
    });
  }

  getGraduationCandidates(): GraduationCandidate[] {
    const config = this.load();
    return config.quarantinedTests
      .filter((t) => t.status === "active")
      .map((t) => ({
        test: t,
        consecutivePasses: t.consecutivePasses,
        healingThreshold: t.healingThreshold,
        isReadyForGraduation: t.consecutivePasses >= t.healingThreshold,
      }))
      .filter((c) => c.isReadyForGraduation);
  }

  listActiveQuarantined(): QuarantinedTestRecord[] {
    const config = this.load();
    return config.quarantinedTests.filter((t) => t.status === "active");
  }
}
