
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { TestPlanService } from '../src/testPlanService';
import { ITestApi } from 'azure-devops-node-api/TestApi';
import { ITestPlanApi } from 'azure-devops-node-api/TestPlanApi';
import { ILogger } from '../src/interfaces/ILogger';

async function testPathTraversal() {
    // Mock Logger
    const mockLogger: ILogger = {
        log: (msg: string) => console.log(`[LOG] ${msg}`),
        warn: (msg: string) => console.log(`[WARN] ${msg}`),
        error: (msg: string, error?: any) => console.log(`[ERROR] ${msg}`, error)
    };

    // Create a file outside CWD.
    const secretContent = "SECRET_CONTENT_12345";
    const secretFile = '/tmp/secret_outside.txt';

    try {
        fs.writeFileSync(secretFile, secretContent);
    } catch (e) {
        console.log("Could not write to /tmp. Trying current dir for setup, but will use path traversal to access.");
    }

    let leakedContent = "";

    // Mock APIs
    const mockTestApi = {
        createTestRun: async () => ({ id: 123 }),
        addTestResultsToTestRun: async (results: any[]) => results.map((r, i) => ({ id: 100 + i })),
        createTestResultAttachment: async (attachmentRequest: any) => {
            // attachmentRequest.stream is base64 encoded content
            const decoded = Buffer.from(attachmentRequest.stream, 'base64').toString('utf-8');
            if (decoded === secretContent) {
                console.log("🚨 MOCK API RECEIVED SECRET CONTENT!");
                leakedContent = decoded;
            }
        },
        updateTestRun: async () => ({ state: 'Completed' })
    } as unknown as ITestApi;

    const mockTestPlanApi = {
        getPointsList: async () => []
    } as unknown as ITestPlanApi;

    console.log(`--- Starting Reproduction of Path Traversal ---`);
    console.log(`CWD: ${process.cwd()}`);
    console.log(`Target File: ${secretFile}`);

    if (!fs.existsSync(secretFile)) {
        console.error("❌ Failed to create secret file. Cannot proceed.");
        process.exit(1);
    }

    const service = new TestPlanService(
        mockTestApi,
        mockTestPlanApi,
        "Project",
        "https://dev.azure.com/org",
        false,
        false,
        mockLogger
    );

    try {
        await service.createRunAndPublish(
            1, "Suite", 1, "Build.1",
            [{
                testCaseTitle: "Malicious Test",
                automatedTestName: "Malicious Test",
                outcome: "Failed",
                localAttachments: [secretFile] // MALICIOUS INPUT
            }],
            [1] // pointIds
        );
    } catch (e) {
        console.log("Execution error:", e);
    } finally {
        // Cleanup
        try {
            if (fs.existsSync(secretFile)) {
                fs.unlinkSync(secretFile);
                console.log(`[CLEANUP] Deleted ${secretFile}`);
            }
        } catch (e) {
            console.log(`[CLEANUP] Failed to delete ${secretFile}`, e);
        }
    }

    if (leakedContent === secretContent) {
        console.error("❌ FAIL: Service read and uploaded the file outside CWD.");
        throw new Error("Path Traversal Vulnerability Detected");
    } else {
        console.log("✅ PASS: Service did NOT read the file.");
    }
}

// Execute if run directly
if (require.main === module) {
    testPathTraversal().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
