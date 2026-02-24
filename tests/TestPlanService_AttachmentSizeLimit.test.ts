
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { TestPlanService } from '../src/testPlanService';
import { ITestApi } from 'azure-devops-node-api/TestApi';
import { ITestPlanApi } from 'azure-devops-node-api/TestPlanApi';
import { ILogger } from '../src/interfaces/ILogger';

async function testAttachmentSizeLimit() {
    // Mock Logger
    const logs: string[] = [];
    const mockLogger: ILogger = {
        log: (msg: string) => logs.push(`[LOG] ${msg}`),
        warn: (msg: string) => logs.push(`[WARN] ${msg}`),
        error: (msg: string, error?: any) => logs.push(`[ERROR] ${msg} ${error ? error : ''}`)
    };

    // --- SETUP: Create a large file (sparse) > 50MB ---
    const largeFile = 'large_file_test.bin';
    const LARGE_SIZE = 51 * 1024 * 1024; // 51MB

    try {
        const fd = fs.openSync(largeFile, 'w');
        fs.ftruncateSync(fd, LARGE_SIZE);
        fs.closeSync(fd);
    } catch (e) {
        console.error("Could not create large file. Skipping test.", e);
        return;
    }

    // --- SETUP: Create a small valid file ---
    const smallFile = 'small_file_test.txt';
    fs.writeFileSync(smallFile, "SMALL_CONTENT");

    let uploadedFiles: string[] = [];

    // Mock APIs
    const mockTestApi = {
        createTestRun: async () => ({ id: 999 }),
        addTestResultsToTestRun: async (results: any[]) => results.map((r, i) => ({ id: 100 + i })),
        createTestRunAttachment: async (attachmentRequest: any) => {
            // We just track the filename
            uploadedFiles.push(attachmentRequest.fileName);
        },
        createTestResultAttachment: async (attachmentRequest: any) => {
            uploadedFiles.push(attachmentRequest.fileName);
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
    console.log(`Large File: ${largeFile} (${(fs.statSync(largeFile).size / 1024 / 1024).toFixed(2)} MB)`);

    try {
        // Test: Try to upload both files (as run attachment and result attachment)

        // 1. Run Attachment
        await service.createRunAndPublish(
            1, "Suite", 1, "Build.1",
            [], // no results
            [],
            largeFile // <--- LARGE ARGUMENT
        );

        // 2. Result Attachment
        const results = [{
            testCaseTitle: "TC1",
            automatedTestName: "TC1",
            durationInMs: 100,
            outcome: "Passed",
            state: "Completed",
            localAttachments: [largeFile, smallFile]
        }];

        await service.createRunAndPublish(
            1, "Suite", 1, "Build.1",
            results as any,
            [],
            undefined
        );

    } catch (e) {
        console.error("Execution error:", e);
    } finally {
        // Cleanup
        if (fs.existsSync(largeFile)) fs.unlinkSync(largeFile);
        if (fs.existsSync(smallFile)) fs.unlinkSync(smallFile);
    }

    // Assertions
    let passed = true;

    // Check Run Attachment (should be skipped if fix is applied)
    // Initially (before fix), it might be uploaded or crash (if memory limit hit).
    // In this environment, it likely uploads.

    const largeFileUploaded = uploadedFiles.includes(largeFile);
    const smallFileUploaded = uploadedFiles.includes(smallFile);

    console.log("Uploaded Files:", uploadedFiles);

    // We expect largeFile NOT to be uploaded if protection is in place.
    if (largeFileUploaded) {
        console.error("❌ FAIL: Service uploaded the large file (>50MB).");
        passed = false;
    } else {
        console.log("✅ PASS: Service blocked the large file.");

        // Verify warning log
        const warningFound = logs.some(l => l.includes('too large') || l.includes('Skipping'));
        if (!warningFound) {
             console.warn("⚠️ WARNING: Expected size warning log not found.");
        } else {
             console.log("✅ Verified: Size warning log found.");
        }
    }

    if (!smallFileUploaded) {
        console.error("❌ FAIL: Service failed to upload the small valid file.");
        passed = false;
    }

    if (!passed) {
        process.exit(1);
    }
}

// Execute
if (require.main === module) {
    testAttachmentSizeLimit().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
