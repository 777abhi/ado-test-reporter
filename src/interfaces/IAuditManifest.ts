export interface ExecutionProvenance {
    commitSha: string;
    branch: string;
    buildId: number;
    buildNumber: string;
    buildUri?: string;
    triggerActor: string;
    agentName: string;
    repositoryUrl?: string;
    timestamp: string;
}

export interface ArtifactAuditRecord {
    fileName: string;
    relativePath: string;
    sha256: string;
    sizeBytes: number;
    category: "junit_results" | "test_attachment" | "audit_manifest";
}

export interface AuditEvidenceManifest {
    manifestVersion: string;
    generatedAt: string;
    provenance: ExecutionProvenance;
    artifacts: ArtifactAuditRecord[];
    summary: {
        totalTests: number;
        passed: number;
        failed: number;
        quarantined: number;
    };
}
