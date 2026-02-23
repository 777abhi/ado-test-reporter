
import * as fs from 'fs';
import * as path from 'path';
import { TestPlanService } from '../src/testPlanService';
import { ITestApi } from 'azure-devops-node-api/TestApi';
import { ITestPlanApi } from 'azure-devops-node-api/TestPlanApi';
import { ILogger } from '../src/interfaces/ILogger';

async function testSymlinkPathTraversal() {
    // Mock Logger
    const logs: string[] = [];
    const mockLogger: ILogger = {
        log: (msg: string) => logs.push(`[LOG] ${msg}`),
        warn: (msg: string) => logs.push(`[WARN] ${msg}`),
        error: (msg: string, error?: any) => logs.push(`[ERROR] ${msg} ${error ? error : ''}`)
    };

    // --- SETUP: Create file outside allowed scope ---
    // In this sandbox, everything is under /app. We simulate "outside" by creating a folder /app/restricted
    // and setting allowed root to /app/public.
    const rootDir = process.cwd();
    const restrictedDir = path.join(rootDir, 'restricted_test_dir');
    const publicDir = path.join(rootDir, 'public_test_dir');

    if (!fs.existsSync(restrictedDir)) fs.mkdirSync(restrictedDir);
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

    const secretContent = "SECRET_CONTENT_SYMLINK";
    const secretFile = path.join(restrictedDir, 'secret.txt');
    fs.writeFileSync(secretFile, secretContent);

    // Create a symlink in publicDir pointing to secretFile
    const symlinkFile = path.join(publicDir, 'link_to_secret.txt');
    try {
        if (fs.existsSync(symlinkFile)) fs.unlinkSync(symlinkFile);
        fs.symlinkSync(secretFile, symlinkFile);
    } catch (e) {
        console.error("Could not create symlink. Skipping test.");
        return;
    }

    let leakedContent = "";

    // Mock APIs
    const mockTestApi = {
        createTestRun: async () => ({ id: 999 }),
        addTestResultsToTestRun: async (results: any[]) => results.map((r, i) => ({ id: 100 + i })),
        createTestRunAttachment: async (attachmentRequest: any) => {
            const decoded = Buffer.from(attachmentRequest.stream, 'base64').toString('utf-8');
            if (decoded === secretContent) {
                leakedContent = decoded;
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

    // HACK: Override process.cwd() temporarily for the service execution context
    // We want the service to think CWD is publicDir
    const originalCwd = process.cwd;
    process.cwd = () => publicDir;

    console.log(`Simulated CWD: ${process.cwd()}`);
    console.log(`Symlink Path (relative to CWD): link_to_secret.txt`);

    try {
        // Attempt to upload the symlink
        // The service resolves path relative to CWD. 'link_to_secret.txt' -> publicDir/link_to_secret.txt
        // Current logic: path.resolve('link_to_secret.txt') -> publicDir/link_to_secret.txt
        // allowedRoot = publicDir
        // startsWith check passes.
        // fs.readFileSync follows symlink -> restrictedDir/secret.txt
        // Content leaked.

        await service.createRunAndPublish(
            1, "Suite", 1, "Build.1",
            [],
            [],
            'link_to_secret.txt'
        );

    } catch (e) {
        console.error("Execution error:", e);
    } finally {
        process.cwd = originalCwd; // Restore CWD
        // Cleanup
        if (fs.existsSync(symlinkFile)) fs.unlinkSync(symlinkFile);
        if (fs.existsSync(secretFile)) fs.unlinkSync(secretFile);
        if (fs.existsSync(restrictedDir)) fs.rmdirSync(restrictedDir);
        if (fs.existsSync(publicDir)) fs.rmdirSync(publicDir);
    }

    if (leakedContent === secretContent) {
        console.error("❌ FAIL: Service followed symlink and uploaded secret file.");
        process.exit(1);
    } else {
        console.log("✅ PASS: Service blocked the symlink.");
        const warningFound = logs.some(l => l.includes('Security Risk') || l.includes('traverses outside'));
        if (warningFound) {
             console.log("✅ Verified: Security warning log found.");
        } else {
             console.warn("⚠️ WARNING: Upload blocked but no explicit security warning logged (maybe file not found handling triggered?).");
        }
    }
}

testSymlinkPathTraversal();
