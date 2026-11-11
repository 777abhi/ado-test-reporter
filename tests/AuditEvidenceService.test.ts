import * as fs from "fs";
import * as path from "path";
import { AuditEvidenceService } from "../src/AuditEvidenceService";
import { ExecutionProvenance } from "../src/interfaces/IAuditManifest";

describe("AuditEvidenceService", () => {
    const testDir = path.resolve(process.cwd(), "tests/temp_audit_evidence");
    const testFile = path.join(testDir, "sample_test.xml");
    let service: AuditEvidenceService;

    beforeAll(() => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        fs.writeFileSync(testFile, "<testsuite name='test'></testsuite>", "utf8");
    });

    afterAll(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    beforeEach(() => {
        service = new AuditEvidenceService();
    });

    it("should compute accurate SHA-256 hash for a file", () => {
        const hash = service.computeFileSha256(testFile);
        expect(hash).toBeDefined();
        expect(hash).toHaveLength(64); // SHA-256 is 64 hex characters
    });

    it("should create artifact record with relative path and metadata", () => {
        const record = service.createArtifactRecord(testFile, "junit_results");
        expect(record).not.toBeNull();
        expect(record?.fileName).toBe("sample_test.xml");
        expect(record?.category).toBe("junit_results");
        expect(record?.sha256).toHaveLength(64);
        expect(record?.sizeBytes).toBeGreaterThan(0);
    });

    it("should create and save AuditEvidenceManifest", () => {
        const provenance: ExecutionProvenance = {
            commitSha: "a1b2c3d4e5f67890",
            branch: "main",
            buildId: 456,
            buildNumber: "Build-456",
            buildUri: "https://dev.azure.com/org/proj/_build/results?buildId=456",
            triggerActor: "alice@example.com",
            agentName: "agent-linux-01",
            timestamp: new Date().toISOString(),
        };

        const artifactRecord = service.createArtifactRecord(testFile, "junit_results")!;
        const manifest = service.createManifest(provenance, [artifactRecord], {
            totalTests: 1,
            passed: 1,
            failed: 0,
            quarantined: 0,
        });

        const outputPath = path.join(testDir, "audit-evidence.json");
        const savedPath = service.saveManifest(manifest, outputPath);

        expect(fs.existsSync(savedPath)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(savedPath, "utf8"));
        expect(parsed.manifestVersion).toBe("1.0");
        expect(parsed.provenance.commitSha).toBe("a1b2c3d4e5f67890");
        expect(parsed.artifacts).toHaveLength(1);
        expect(parsed.artifacts[0].sha256).toBe(artifactRecord.sha256);
    });

    it("should format provenance into readable markdown and HTML", () => {
        const provenance: ExecutionProvenance = {
            commitSha: "fedcba9876543210",
            branch: "release/v1.0",
            buildId: 789,
            buildNumber: "Build-789",
            buildUri: "https://dev.azure.com/org/proj/_build/results?buildId=789",
            triggerActor: "bob@example.com",
            agentName: "agent-02",
            timestamp: "2026-11-10T23:00:00.000Z",
        };

        const md = service.formatProvenanceMarkdown(provenance);
        expect(md).toContain("### 🛡️ Audit Traceability & Provenance");
        expect(md).toContain("`fedcba9876543210`");
        expect(md).toContain("`release/v1.0`");
        expect(md).toContain("[#Build-789]");

        const html = service.formatProvenanceHtml(provenance);
        expect(html).toContain("<code>fedcba9876543210</code>");
        expect(html).toContain("<a href=\"https://dev.azure.com/org/proj/_build/results?buildId=789\">#Build-789</a>");
    });
});
