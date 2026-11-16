import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  chunkArray,
  clampBatchSize,
  clampConcurrency,
  mapWithConcurrency,
} from "../src/utils/AsyncUtils";
import { TestCaseService } from "../src/testCaseService";
import { TestPlanService } from "../src/testPlanService";
import { App } from "../src/App";
import { ILogger } from "../src/interfaces/ILogger";
import { ITestCaseService } from "../src/interfaces/ITestCaseService";
import { ITestPlanService } from "../src/interfaces/ITestPlanService";
import { IFailureTaskService } from "../src/interfaces/IFailureTaskService";
import { ITestResultParser } from "../src/interfaces/ITestResultParser";
import { RunOptions } from "../src/interfaces/RunOptions";

const createMockLogger = (): ILogger => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

describe("AsyncUtils", () => {
  test("clampConcurrency and clampBatchSize enforce safe ADO bounds", () => {
    expect(clampConcurrency(undefined)).toBe(5);
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(100)).toBe(20);
    expect(clampConcurrency(8.9)).toBe(8);

    expect(clampBatchSize(undefined)).toBe(200);
    expect(clampBatchSize(-5)).toBe(1);
    expect(clampBatchSize(5000)).toBe(1000);
    expect(clampBatchSize(5000, 200)).toBe(200);
  });

  test("chunkArray splits items into expected chunks", () => {
    expect(chunkArray([], 5)).toEqual([]);
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("mapWithConcurrency respects concurrency limit and preserves order", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency([10, 20, 30, 40, 50, 60], 2, async (item, idx) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, (6 - idx) * 5));
      active--;
      return item * 2;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([20, 40, 60, 80, 100, 120]);
  });

  test("mapWithConcurrency fails fast when worker throws", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("boom");
        return item;
      })
    ).rejects.toThrow("boom");
  });
});

describe("TestCaseService batching & deduplication", () => {
  test("prefetchByIds batches into chunks of max 200 and warms cache", async () => {
    const getWorkItems = jest.fn().mockImplementation(async (ids: number[]) =>
      ids.map((id) => ({
        id,
        rev: 3,
        fields: { "System.Title": `TC_${id}_Test` },
      }))
    );
    const getWorkItem = jest.fn();

    const mockApi = { getWorkItems, getWorkItem } as any;
    const service = new TestCaseService(mockApi, "MyProject", false, false, createMockLogger());

    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    await service.prefetchByIds(ids, 500); // clamped to 200

    expect(getWorkItems).toHaveBeenCalledTimes(2);
    expect(getWorkItems.mock.calls[0][0]).toHaveLength(200);
    expect(getWorkItems.mock.calls[1][0]).toHaveLength(50);

    // Resolving a prefetched ID should hit cache and not call getWorkItem
    const resolved = await service.resolve("TC_42_Test", "42");
    expect(resolved).toEqual({ id: 42, revision: 3, title: "TC_42_Test" });
    expect(getWorkItem).not.toHaveBeenCalled();
  });

  test("resolve deduplicates concurrent calls for the same testName", async () => {
    const createWorkItem = jest.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { id: 999, rev: 1, fields: { "System.Title": "DuplicateTest" } };
    });

    const mockApi = {
      getWorkItem: jest.fn(),
      queryByWiql: jest.fn().mockResolvedValue({ workItems: [] }),
      createWorkItem,
    } as any;

    const service = new TestCaseService(mockApi, "MyProject", true, true, createMockLogger());
    const [r1, r2, r3] = await Promise.all([
      service.resolve("DuplicateTest", null),
      service.resolve("DuplicateTest", null),
      service.resolve("DuplicateTest", null),
    ]);

    expect(createWorkItem).toHaveBeenCalledTimes(1);
    expect(r1.id).toBe(999);
    expect(r2.id).toBe(999);
    expect(r3.id).toBe(999);
  });
});

describe("TestPlanService chunking & attachment concurrency", () => {
  test("linkTestCasesToSuite chunks >200 test case IDs", async () => {
    const addTestCasesToSuite = jest.fn().mockResolvedValue([]);
    const mockTestApi = {
      getTestCases: jest.fn().mockResolvedValue([]),
      addTestCasesToSuite,
    } as any;

    const service = new TestPlanService(
      mockTestApi,
      {} as any,
      "Proj",
      "https://dev.azure.com/org",
      false,
      false,
      createMockLogger()
    );

    const ids = Array.from({ length: 250 }, (_, i) => String(i + 1));
    await service.linkTestCasesToSuite(10, 20, ids);

    expect(addTestCasesToSuite).toHaveBeenCalledTimes(2);
    expect(addTestCasesToSuite.mock.calls[0][3].split(",")).toHaveLength(200);
    expect(addTestCasesToSuite.mock.calls[1][3].split(",")).toHaveLength(50);
  });

  test("createRunAndPublish chunks results sequentially and isolates attachment errors", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ado-batch-test-"));
    const goodFile = path.join(tmpDir, "good.txt");
    fs.writeFileSync(goodFile, "ok");

    // Ensure isSafePath allows tmpFile by creating inside cwd or mocking?
    // Actually isSafePath checks relative to process.cwd(), so create inside a temp dir in cwd
    const localTmpDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-batch-test-"));
    const localFile1 = path.join(localTmpDir, "a.txt");
    const localFile2 = path.join(localTmpDir, "b.txt");
    fs.writeFileSync(localFile1, "file1");
    fs.writeFileSync(localFile2, "file2");

    try {
      const addOrder: number[] = [];
      const addTestResultsToTestRun = jest.fn().mockImplementation(async (chunk: any[]) => {
        addOrder.push(chunk.length);
        return chunk.map((_, idx) => ({ id: addOrder.length * 100 + idx }));
      });

      const createTestResultAttachment = jest
        .fn()
        .mockRejectedValueOnce(new Error("transient upload error"))
        .mockResolvedValue({});

      const mockTestApi = {
        createTestRun: jest.fn().mockResolvedValue({ id: 555 }),
        addTestResultsToTestRun,
        createTestRunAttachment: jest.fn().mockResolvedValue({}),
        createTestResultAttachment,
        updateTestRun: jest.fn().mockResolvedValue({ id: 555, state: "Completed" }),
      } as any;

      const logger = createMockLogger();
      const service = new TestPlanService(
        mockTestApi,
        {} as any,
        "Proj",
        "https://dev.azure.com/org",
        false,
        false,
        logger
      );

      const results = [
        { testCaseTitle: "T1", outcome: "Passed", localAttachments: [localFile1] },
        { testCaseTitle: "T2", outcome: "Passed", localAttachments: [localFile2] },
        { testCaseTitle: "T3", outcome: "Passed" },
      ] as any[];

      const res = await service.createRunAndPublish(
        1,
        "Suite",
        2,
        "B2",
        results,
        [1, 2, 3],
        undefined,
        undefined,
        undefined,
        { concurrency: 2, batchSize: 2 }
      );

      expect(res.runId).toBe(555);
      expect(addOrder).toEqual([2, 1]);
      expect(createTestResultAttachment).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("transient upload error")
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(localTmpDir, { recursive: true, force: true });
    }
  });
});

describe("App batching, concurrency & defect error isolation", () => {
  test("App prefetches IDs, resolves concurrently, and isolates defect task errors", async () => {
    const logger = createMockLogger();
    const prefetchByIds = jest.fn().mockResolvedValue(undefined);
    const mockTestCaseService: ITestCaseService = {
      prefetchByIds,
      resolve: jest.fn().mockImplementation(async (_name: string, id?: string | null) => ({
        id: id ? Number(id) : 100,
        revision: 1,
        title: _name,
      })),
      updateTestCase: jest.fn(),
      linkRequirementsById: jest.fn(),
      getTestCase: jest.fn(),
      getHtmlFields: jest.fn(),
    };

    const mockTestPlanService: ITestPlanService = {
      ensurePlan: jest.fn().mockResolvedValue({ planId: 1, rootSuiteId: 2 }),
      ensureSuite: jest.fn().mockResolvedValue({ suiteId: 3 }),
      linkTestCasesToSuite: jest.fn().mockResolvedValue(undefined),
      mapPointsToResults: jest.fn().mockImplementation(async (_p, _s, results: any[]) => {
        results.forEach((r, idx) => {
          r.testPoint = { id: String(idx + 10) };
        });
        return [10, 11, 12];
      }),
      createRunAndPublish: jest.fn().mockResolvedValue({ runId: 77, runUrl: "https://ado/run/77" }),
      isTestFlaky: jest.fn().mockResolvedValue(false),
    };

    const createTaskForFailure = jest
      .fn()
      .mockRejectedValueOnce(new Error("work item failure"))
      .mockResolvedValue(undefined);
    const resolveTaskForSuccess = jest.fn().mockResolvedValue(undefined);

    const mockFailureTaskService: IFailureTaskService = {
      createTaskForFailure,
      resolveTaskForSuccess,
    };

    const mockParser: ITestResultParser = {
      parse: jest.fn().mockResolvedValue([
        { name: "TestA_TC101", outcome: "Failed", durationMs: 10, errorMessage: "errA" },
        { name: "TestB_TC102", outcome: "Failed", durationMs: 10, errorMessage: "errB" },
        { name: "TestC_TC103", outcome: "Passed", durationMs: 10 },
      ]),
    };

    const app = new App(
      mockTestCaseService,
      mockTestPlanService,
      mockFailureTaskService,
      mockParser,
      logger
    );

    const options: RunOptions = {
      planName: "Plan",
      suiteName: "Suite",
      buildId: 1,
      buildNumber: "1",
      attachResults: false,
      createFailureTasks: true,
      autoCloseOnPass: true,
      concurrency: 2,
      batchSize: 50,
    };

    const summary = await app.run(options, "dummy.xml");

    expect(summary?.runId).toBe(77);
    expect(prefetchByIds).toHaveBeenCalledWith([101, 102, 103], 50);
    expect(createTaskForFailure).toHaveBeenCalledTimes(2);
    expect(resolveTaskForSuccess).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("work item failure"));
  });
});
