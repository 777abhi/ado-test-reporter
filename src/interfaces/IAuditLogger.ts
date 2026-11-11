import { ILogger } from "./ILogger";

export type AuditLevel = "INFO" | "WARN" | "ERROR" | "SECURITY";

export interface AuditEvent {
    timestamp: string;
    eventType: string;
    level: AuditLevel;
    action: string;
    actor?: string;
    buildId?: number;
    commitSha?: string;
    targetId?: string | number;
    details?: Record<string, any>;
    status?: "SUCCESS" | "FAILURE" | "SKIPPED" | "WARNING";
}

export interface IAuditLogger extends ILogger {
    logAudit(event: Omit<AuditEvent, "timestamp">): void;
    getAuditEvents(): AuditEvent[];
    flush(): void;
}
