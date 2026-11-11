export type QuarantineStatus = "active" | "graduated" | "removed" | "expired";

export interface QuarantineAuditEntry {
  action: "quarantined" | "re_quarantined" | "graduated" | "unquarantined" | "expired" | "soft_passed";
  timestamp: string;
  actor?: string;
  details?: string;
}

export interface QuarantinedTestRecord {
  testKey: string;
  testCaseId?: string;
  testCaseTitle: string;
  quarantinedAt: string;
  quarantinedBy?: string;
  reason: string;
  consecutivePasses: number;
  healingThreshold: number;
  status: QuarantineStatus;
  lastObservedAt?: string;
  lastOutcome?: string;
  graduatedAt?: string;
  notes?: string;
  linkedWorkItemId?: string;
  reasonCode?: string;
  ttlDays?: number;
  expiresAt?: string;
  auditHistory?: QuarantineAuditEntry[];
}

export interface QuarantineConfigFile {
  version: number;
  lastUpdated: string;
  quarantinedTests: QuarantinedTestRecord[];
}

export interface QuarantineAddOptions {
  testKey?: string;
  testCaseId?: string | number;
  testCaseTitle: string;
  reason: string;
  quarantinedBy?: string;
  healingThreshold?: number;
  notes?: string;
  linkedWorkItemId?: string;
  reasonCode?: string;
  ttlDays?: number;
}

export interface GraduationCandidate {
  test: QuarantinedTestRecord;
  consecutivePasses: number;
  healingThreshold: number;
  isReadyForGraduation: boolean;
}

export interface QuarantineOutcomeResult {
  record?: QuarantinedTestRecord;
  isQuarantined: boolean;
  isReadyForGraduation: boolean;
  isExpired?: boolean;
}

export interface IQuarantineService {
  getConfigFilePath(): string;
  load(): QuarantineConfigFile;
  save(config: QuarantineConfigFile): void;
  isQuarantined(testCaseId?: string | number, testName?: string): boolean;
  getQuarantinedTest(
    testCaseId?: string | number,
    testName?: string
  ): QuarantinedTestRecord | undefined;
  quarantineTest(options: QuarantineAddOptions): QuarantinedTestRecord;
  unquarantineTest(testKeyOrId: string, reason?: string): boolean;
  graduateTest(testKeyOrId: string, notes?: string): boolean;
  recordExecutionOutcome(
    testCaseId: string | number | undefined,
    testName: string,
    outcome: string
  ): QuarantineOutcomeResult;
  getGraduationCandidates(): GraduationCandidate[];
  listActiveQuarantined(): QuarantinedTestRecord[];
  checkExpirations(): QuarantinedTestRecord[];
}
