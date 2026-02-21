
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { TestPlanService } from '../src/testPlanService';
import { ITestApi } from 'azure-devops-node-api/TestApi';
import { ITestPlanApi } from 'azure-devops-node-api/TestPlanApi';
import { ILogger } from '../src/interfaces/ILogger';

async function testAttachmentPathTraversal() {
    // Mock Logger
    const logs: string[] = [];
    const mockLogger: ILogger = {
        log: (msg: string) => logs.push(`[LOG] ${msg}`),
        warn: (msg: string) => logs.push(`[WARN] ${msg}`),
        error: (msg: string, error?: any) => logs.push(`[ERROR] ${msg} ${error ? error : ''}`)
    };

    // --- SETUP: Create file outside CWD ---
    const secretContent = "SECRET_CONTENT_12345";
    const secretFile = '/tmp/secret_outside_cwd_test.txt';

    try {
        fs.writeFileSync(secretFile, secretContent);
    } catch (e) {
        console.error("Could not write to /tmp. Skipping test as environment doesn't allow external file creation.");
        return;
    }

    // --- SETUP: Create file inside CWD ---
    const validContent = "VALID_CONTENT_ABCDE";
    const validFile = 'valid_inside_cwd_test.txt';
    fs.writeFileSync(validFile, validContent);

    let leakedContent = "";
    let uploadedValidContent = "";

    // Mock APIs
    const mockTestApi = {
        createTestRun: async () => ({ id: 999 }),
        addTestResultsToTestRun: async (results: any[]) => results.map((r, i) => ({ id: 100 + i })),
        createTestRunAttachment: async (attachmentRequest: any) => {
            // attachmentRequest.stream is base64 encoded content
            const decoded = Buffer.from(attachmentRequest.stream, 'base64').toString('utf-8');
            if (decoded === secretContent) {
                leakedContent = decoded;
            } else if (decoded === validContent) {
                uploadedValidContent = decoded;
            }
        },
        updateTestRun: async () => ({ state: 'Completed' })
    } as unknown as ITestApi;

    const mockTestPlanApi = {
        getPointsList: async () => []
    } as unknown as ITestPlanApi;

    const service = new TestPlanService(
        mockTestApi,
        mockTestPlanApi,
        "Project",
        "https://dev.azure.com/org",
        false,
        false,
        mockLogger
    );

    console.log(`CWD: ${process.cwd()}`);
    console.log(`Target Secret File: ${secretFile}`);
    console.log(`Target Valid File: ${validFile}`);

    try {
        // Test 1: Path Traversal Attempt (Should fail/warn/skip)
        await service.createRunAndPublish(
            1, "Suite", 1, "Build.1",
            [],
            [],
            secretFile // <--- VULNERABLE ARGUMENT
        );

        // Test 2: Valid File Upload (Should succeed)
        await service.createRunAndPublish(
            1, "Suite", 1, "Build.1",
            [],
            [],
            validFile // <--- VALID ARGUMENT
        );

    } catch (e) {
        console.error("Execution error:", e);
    } finally {
        // Cleanup
        if (fs.existsSync(secretFile)) fs.unlinkSync(secretFile);
        if (fs.existsSync(validFile)) fs.unlinkSync(validFile);
    }

    // Assertions
    let passed = true;

    if (leakedContent === secretContent) {
        console.error("❌ FAIL: Service uploaded the secret file outside CWD.");
        passed = false;
    } else {
        console.log("✅ PASS: Service blocked the secret file.");
        // Verify warning log
        const warningFound = logs.some(l => l.includes('Security Risk') && l.includes(secretFile));
        if (!warningFound) {
             console.warn("⚠️ WARNING: Expected security warning log not found, but upload was blocked (or failed silently).");
        } else {
             console.log("✅ Verified: Security warning log found.");
        }
    }

    if (uploadedValidContent !== validContent) {
        console.error("❌ FAIL: Service failed to upload the valid file inside CWD.");
        passed = false;
    } else {
        console.log("✅ PASS: Service uploaded the valid file.");
    }

    if (!passed) {
        process.exit(1);
    }
}

// Execute
if (require.main === module) {
    testAttachmentPathTraversal().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
