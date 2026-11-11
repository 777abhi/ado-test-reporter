import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
    AuditEvidenceManifest,
    ArtifactAuditRecord,
    ExecutionProvenance,
} from "./interfaces/IAuditManifest";
import { ILogger } from "./interfaces/ILogger";
import { isSafePath } from "./utils/PathUtils";

export class AuditEvidenceService {
    constructor(
        private logger?: ILogger,
        private rootDir: string = process.cwd()
    ) { }

    computeFileSha256(filePath: string): string {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found for SHA-256 calculation: ${filePath}`);
        }
        const fileBuffer = fs.readFileSync(filePath);
        return crypto.createHash("sha256").update(fileBuffer).digest("hex");
    }

    createArtifactRecord(
        filePath: string,
        category: "junit_results" | "test_attachment" | "audit_manifest"
    ): ArtifactAuditRecord | null {
        try {
            if (!isSafePath(filePath, this.rootDir)) {
                this.logger?.warn(`⚠️ Security Risk: Skipping artifact checksum on unsafe path: ${filePath}`);
                return null;
            }
            if (!fs.existsSync(filePath)) {
                return null;
            }
            const stats = fs.statSync(filePath);
            const sha256 = this.computeFileSha256(filePath);
            const relativePath = path.relative(this.rootDir, filePath);
            return {
                fileName: path.basename(filePath),
                relativePath,
                sha256,
                sizeBytes: stats.size,
                category,
            };
        } catch (err: any) {
            this.logger?.warn(`⚠️ Failed to compute checksum for ${filePath}: ${err?.message || err}`);
            return null;
        }
    }

    createManifest(
        provenance: ExecutionProvenance,
        artifacts: ArtifactAuditRecord[],
        summary: {
            totalTests: number;
            passed: number;
            failed: number;
            quarantined: number;
        }
    ): AuditEvidenceManifest {
        return {
            manifestVersion: "1.0",
            generatedAt: new Date().toISOString(),
            provenance,
            artifacts,
            summary,
        };
    }

    saveManifest(manifest: AuditEvidenceManifest, outputPath: string): string {
        const resolved = path.isAbsolute(outputPath)
            ? outputPath
            : path.resolve(this.rootDir, outputPath);

        if (!isSafePath(resolved, this.rootDir)) {
            throw new Error(`Insecure audit manifest output path: ${outputPath}`);
        }

        const dir = path.dirname(resolved);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(resolved, JSON.stringify(manifest, null, 2), "utf8");
        this.logger?.log(`🛡️ Generated cryptographic audit manifest at: ${resolved}`);
        return resolved;
    }

    formatProvenanceMarkdown(provenance: ExecutionProvenance): string {
        const lines: string[] = [
            "### 🛡️ Audit Traceability & Provenance",
            `- **Commit SHA**: \`${provenance.commitSha}\``,
            `- **Branch**: \`${provenance.branch}\``,
            provenance.buildUri
                ? `- **Build**: [#${provenance.buildNumber}](${provenance.buildUri}) (ID: ${provenance.buildId})`
                : `- **Build**: #${provenance.buildNumber} (ID: ${provenance.buildId})`,
            `- **Triggered By**: \`${provenance.triggerActor}\``,
            `- **Agent / Host**: \`${provenance.agentName}\``,
            `- **Executed At**: \`${provenance.timestamp}\``,
        ];
        return lines.join("\n");
    }

    formatProvenanceHtml(provenance: ExecutionProvenance): string {
        const buildLink = provenance.buildUri
            ? `<a href="${provenance.buildUri}">#${provenance.buildNumber}</a>`
            : `#${provenance.buildNumber}`;

        return [
            "<div><strong>🛡️ Audit Traceability & Provenance</strong></div>",
            "<ul>",
            `  <li><strong>Commit SHA:</strong> <code>${provenance.commitSha}</code></li>`,
            `  <li><strong>Branch:</strong> <code>${provenance.branch}</code></li>`,
            `  <li><strong>Build:</strong> ${buildLink} (ID: ${provenance.buildId})</li>`,
            `  <li><strong>Triggered By:</strong> <code>${provenance.triggerActor}</code></li>`,
            `  <li><strong>Agent / Host:</strong> <code>${provenance.agentName}</code></li>`,
            `  <li><strong>Executed At:</strong> <code>${provenance.timestamp}</code></li>`,
            "</ul>",
        ].join("\n");
    }
}
