import * as fs from "fs";
import * as path from "path";
import { AuditEvent, IAuditLogger } from "./interfaces/IAuditLogger";
import { SecretRedactor } from "./utils/SecretRedactor";
import { isSafePath } from "./utils/PathUtils";

export class AuditLogger implements IAuditLogger {
    private events: AuditEvent[] = [];
    private resolvedFilePath?: string;

    constructor(
        private auditFilePath?: string,
        private rootDir: string = process.cwd()
    ) {
        if (this.auditFilePath) {
            const resolved = path.isAbsolute(this.auditFilePath)
                ? this.auditFilePath
                : path.resolve(this.rootDir, this.auditFilePath);

            if (isSafePath(resolved, this.rootDir)) {
                this.resolvedFilePath = resolved;
            } else {
                console.warn(
                    `⚠️ [SECURITY] Audit log path '${this.auditFilePath}' is unsafe or traverses outside working directory. Disabling file output.`
                );
            }
        }
    }

    log(message: string): void {
        console.log(SecretRedactor.redact(message));
    }

    warn(message: string, error?: any): void {
        const redactedMessage = SecretRedactor.redact(message);
        if (error) {
            const errorStr =
                typeof error === "string" ? error : error.message || JSON.stringify(error);
            console.warn(redactedMessage, SecretRedactor.redact(errorStr));
        } else {
            console.warn(redactedMessage);
        }
    }

    error(message: string, error?: any): void {
        const redactedMessage = SecretRedactor.redact(message);
        if (error) {
            const errorStr =
                typeof error === "string" ? error : error.message || JSON.stringify(error);
            console.error(redactedMessage, SecretRedactor.redact(errorStr));
        } else {
            console.error(redactedMessage);
        }
    }

    logAudit(event: Omit<AuditEvent, "timestamp">): void {
        const fullEvent: AuditEvent = {
            timestamp: new Date().toISOString(),
            ...event,
        };

        // Redact any sensitive content in stringified details
        if (fullEvent.details) {
            try {
                const jsonStr = JSON.stringify(fullEvent.details);
                const redactedStr = SecretRedactor.redact(jsonStr);
                fullEvent.details = JSON.parse(redactedStr);
            } catch {
                // Keep details as is if JSON roundtrip fails
            }
        }

        this.events.push(fullEvent);

        // Console indicator for visibility
        const actorStr = fullEvent.actor ? ` [Actor: ${fullEvent.actor}]` : "";
        const targetStr = fullEvent.targetId !== undefined ? ` [Target: ${fullEvent.targetId}]` : "";
        const statusStr = fullEvent.status ? ` [${fullEvent.status}]` : "";
        this.log(`🛡️ [AUDIT_${fullEvent.level}] ${fullEvent.action}${actorStr}${targetStr}${statusStr}`);

        // Write to file (NDJSON) if configured
        if (this.resolvedFilePath) {
            try {
                const dir = path.dirname(this.resolvedFilePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.appendFileSync(this.resolvedFilePath, JSON.stringify(fullEvent) + "\n", "utf8");
            } catch (err: any) {
                console.warn(
                    `⚠️ Failed to write audit event to file: ${SecretRedactor.redact(err?.message || String(err))}`
                );
            }
        }
    }

    getAuditEvents(): AuditEvent[] {
        return [...this.events];
    }

    flush(): void {
        // Can be used if buffered writing is implemented in future
    }
}
