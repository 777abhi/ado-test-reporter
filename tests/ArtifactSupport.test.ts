
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { App } from '../src/App';
import { ITestCaseService } from '../src/interfaces/ITestCaseService';
import { ITestPlanService, TestCaseResultWithAttachments } from '../src/interfaces/ITestPlanService';
import { IFailureTaskService, FailureInfo } from '../src/interfaces/IFailureTaskService';
import { ITestResultParser, ParsedTestCase } from '../src/interfaces/ITestResultParser';
import { ILogger } from '../src/interfaces/ILogger';
import { RunOptions } from '../src/interfaces/RunOptions';

async function testArtifactSupport() {
    console.log("🚀 Starting Artifact Support Test...");

    // --- SETUP: Create temp dir and artifacts ---
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'temp-test-artifacts-'));
    const testName = "Test_Case_123";
    const artifactName = `${testName}.png`;
    const artifactPath = path.join(tempDir, artifactName);
    const dummyContent = "Start of artifact content";

    fs.writeFileSync(artifactPath, dummyContent);
    console.log(`📂 Created dummy artifact at: ${artifactPath}`);

    const junitFile = path.join(tempDir, 'results.xml');
    fs.writeFileSync(junitFile, '<testsuites></testsuites>'); // Minimal dummy XML

    // --- MOCKS ---
    const mockLogger: ILogger = {
        log: (msg: string) => console.log(`[LOG] ${msg}`),
        warn: (msg: string) => console.log(`[WARN] ${msg}`),
        error: (msg: string, error?: any) => console.error(`[ERROR] ${msg} ${error ? error : ''}`)
    };

    const mockParser: ITestResultParser = {
        parse: async (filePath: string) => {
            const tc: ParsedTestCase = {
                name: testName,
                durationMs: 100,
                outcome: "Failed",
                errorMessage: "Something went wrong",
                attachments: []
            };
            return [tc];
        }
    };

    const mockTestCaseService: ITestCaseService = {
        resolve: async (testName: string, testCaseId: string | null) => {
            return { id: 101, revision: 1 };
        }
    } as unknown as ITestCaseService;

    let capturedResults: TestCaseResultWithAttachments[] = [];
    const mockTestPlanService: ITestPlanService = {
        ensurePlan: async () => ({ planId: 1, rootSuiteId: 10 }),
        ensureSuite: async () => ({ suiteId: 20 }),
        linkTestCasesToSuite: async () => {},
        mapPointsToResults: async (planId: number, suiteId: number, results: any[]) => {
            // Assign dummy test point to prevent filtering
            results.forEach((r: any) => r.testPoint = { id: "999" });
            return [999];
        },
        createRunAndPublish: async (planId: number, suiteName: string, buildId: number, buildNumber: string, results: TestCaseResultWithAttachments[], pointIds: number[], attachmentPath?: string) => {
            capturedResults = results;
            return { runId: 500, runUrl: "http://dummy/run/500" };
        }
    } as unknown as ITestPlanService;

    let capturedTaskAttachments: string[] = [];
    const mockFailureTaskService: IFailureTaskService = {
        createTaskForFailure: async (failureInfo: FailureInfo) => {
            capturedTaskAttachments = failureInfo.attachments || [];
        },
        resolveTaskForSuccess: async () => {}
    } as unknown as IFailureTaskService;

    // --- EXECUTION ---
    const app = new App(
        mockTestCaseService,
        mockTestPlanService,
        mockFailureTaskService,
        mockParser,
        mockLogger
    );

    const options: RunOptions = {
        planName: "Test Plan",
        suiteName: "Test Suite",
        buildId: 1,
        buildNumber: "1.0.0",
        attachResults: false,
        createFailureTasks: true,
        autoCloseOnPass: false,
        artifactsDir: tempDir,
        artifactPattern: "{testName}.png"
    };

    try {
        await app.run(options, junitFile);
    } catch (e) {
        console.error("❌ App execution failed:", e);
        process.exit(1);
    } finally {
        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // --- ASSERTIONS ---
    let passed = true;

    // Check Test Result Attachments
    if (capturedResults.length === 0) {
        console.error("❌ FAIL: No results were published.");
        passed = false;
    } else {
        const result = capturedResults[0];
        if (!result.localAttachments || result.localAttachments.length === 0) {
            console.error("❌ FAIL: Result has no attachments.");
            passed = false;
        } else {
            const attachedFile = result.localAttachments[0];
            if (attachedFile === artifactPath) {
                console.log("✅ PASS: Correct artifact attached to Test Result.");
            } else {
                console.error(`❌ FAIL: Expected attachment ${artifactPath}, got ${attachedFile}`);
                passed = false;
            }
        }
    }

    // Check Failure Task Attachments
    if (capturedTaskAttachments.length === 0) {
        console.error("❌ FAIL: Failure task has no attachments.");
        passed = false;
    } else {
        const attachedFile = capturedTaskAttachments[0];
        if (attachedFile === artifactPath) {
             console.log("✅ PASS: Correct artifact attached to Failure Task.");
        } else {
             console.error(`❌ FAIL: Expected task attachment ${artifactPath}, got ${attachedFile}`);
             passed = false;
        }
    }

    if (!passed) {
        process.exit(1);
    } else {
        console.log("🎉 All checks passed!");
    }
}

if (require.main === module) {
    testArtifactSupport().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
