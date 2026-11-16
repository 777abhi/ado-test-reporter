import { fetchAllPages, fetchAllSkipTop } from "../src/utils/AsyncUtils";
import { TestPlanService } from "../src/testPlanService";
import { DashboardDataService } from "../src/DashboardDataService";
import { PrQualityGateService } from "../src/PrQualityGateService";
import { ILogger } from "../src/interfaces/ILogger";

const createMockLogger = (): ILogger => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const makePaged = <T>(items: T[], continuationToken?: string) => {
  const arr: any = [...items];
  if (continuationToken) {
    arr.continuationToken = continuationToken;
  }
  return arr;
};

describe("Pagination utilities", () => {
  test("fetchAllPages traverses continuationToken across multiple pages", async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce(makePaged([1, 2], "tok-2"))
      .mockResolvedValueOnce(makePaged([3, 4], "tok-3"))
      .mockResolvedValueOnce(makePaged([5]));

    const result = await fetchAllPages(fetchPage);
    expect(result).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "tok-2");
    expect(fetchPage).toHaveBeenNthCalledWith(3, "tok-3");
  });

  test("fetchAllPages stops on duplicate continuationToken or maxPages", async () => {
    const dupFetch = jest
      .fn()
      .mockResolvedValueOnce(makePaged([1], "same"))
      .mockResolvedValueOnce(makePaged([2], "same"));

    expect(await fetchAllPages(dupFetch)).toEqual([1, 2]);
    expect(dupFetch).toHaveBeenCalledTimes(2);

    const infiniteFetch = jest
      .fn()
      .mockImplementation(async (tok?: string) => makePaged([1], `t-${tok || 0}`));
    expect(await fetchAllPages(infiniteFetch, 3)).toEqual([1, 1, 1]);
    expect(infiniteFetch).toHaveBeenCalledTimes(3);
  });

  test("fetchAllSkipTop paginates until page.length < pageSize", async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce([1, 2])
      .mockResolvedValueOnce([3, 4])
      .mockResolvedValueOnce([5]);

    const result = await fetchAllSkipTop(fetchPage, 2);
    expect(result).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 2);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 2, 2);
    expect(fetchPage).toHaveBeenNthCalledWith(3, 4, 2);
  });
});

describe("TestPlanService pagination", () => {
  test("ensurePlan, ensureSuite, and mapPointsToResults traverse all continuation pages", async () => {
    const mockTestPlanApi = {
      getTestPlans: jest
        .fn()
        .mockResolvedValueOnce(makePaged([{ id: 1, name: "Plan A" }], "p2"))
        .mockResolvedValueOnce(makePaged([{ id: 2, name: "Target Plan", rootSuite: { id: 10 } }])),
      getTestSuitesForPlan: jest
        .fn()
        .mockResolvedValueOnce(makePaged([{ id: 11, name: "Suite 1" }], "s2"))
        .mockResolvedValueOnce(makePaged([{ id: 12, name: "Target Suite" }])),
      getPointsList: jest
        .fn()
        .mockResolvedValueOnce(
          makePaged([{ id: 100, testCaseReference: { id: "501", name: "T1" } }], "pt2")
        )
        .mockResolvedValueOnce(
          makePaged([{ id: 101, testCaseReference: { id: "502", name: "T2" } }])
        ),
    } as any;

    const service = new TestPlanService(
      {} as any,
      mockTestPlanApi,
      "Proj",
      "https://dev.azure.com/org",
      false,
      false,
      createMockLogger()
    );

    const plan = await service.ensurePlan("Target Plan");
    expect(plan).toEqual({ planId: 2, rootSuiteId: 10 });

    const suite = await service.ensureSuite(2, 10, "Target Suite");
    expect(suite).toEqual({ suiteId: 12 });

    const results: any[] = [
      { testCase: { id: "501" } },
      { testCase: { id: "502" } },
    ];
    const pointIds = await service.mapPointsToResults(2, 12, results);
    expect(pointIds).toEqual([100, 101]);
    expect(results[0].testPoint).toEqual({ id: "100" });
    expect(results[1].testPoint).toEqual({ id: "101" });
  });
});

describe("DashboardDataService & PrQualityGateService pagination", () => {
  test("DashboardDataService paginates getTestResults and chunks getWorkItems by 200", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1,
      testCaseTitle: `Test_${i + 1}`,
      outcome: "Passed",
      durationInMs: 10,
      testCase: { id: String(i + 1) },
    }));
    const page2 = [
      {
        id: 1001,
        testCaseTitle: "Test_1001",
        outcome: "Failed",
        durationInMs: 20,
        testCase: { id: "1001" },
      },
    ];

    const getTestResults = jest
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const workItemRefs = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
    const getWorkItems = jest.fn().mockImplementation(async (ids: number[]) =>
      ids.map((id) => ({
        id,
        fields: {
          "System.Title": `Test Failure [TC ${id}]`,
          "System.State": "Active",
          "System.WorkItemType": "Bug",
          "System.Tags": "",
        },
      }))
    );

    const mockTestApi = {
      queryTestRuns: jest.fn().mockResolvedValueOnce([
        {
          id: 90,
          name: "Large Run",
          startedDate: new Date().toISOString(),
          completedDate: new Date().toISOString(),
        },
      ]),
      getTestResults,
    } as any;

    const mockWorkItemApi = {
      queryByWiql: jest.fn().mockResolvedValue({ workItems: workItemRefs }),
      getWorkItems,
    } as any;

    const mockCacheRepo = {
      load: jest.fn().mockReturnValue({ runs: [] }),
      save: jest.fn(),
      upsertRuns: jest.fn().mockImplementation((runs: any[]) => ({ runs })),
    } as any;

    const service = new DashboardDataService(
      mockCacheRepo,
      createMockLogger(),
      "https://dev.azure.com/org",
      "Proj",
      mockTestApi,
      mockWorkItemApi,
      "Bug"
    );

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
    const cacheData = await service.syncFromAdo(startDate, endDate);
    expect(getTestResults).toHaveBeenCalledTimes(2);
    expect(getTestResults).toHaveBeenNthCalledWith(1, "Proj", 90, undefined, 0, 1000);
    expect(getTestResults).toHaveBeenNthCalledWith(2, "Proj", 90, undefined, 1000, 1000);
    expect(cacheData.runs[0].results).toHaveLength(1001);

    expect(getWorkItems).toHaveBeenCalledTimes(2);
    expect(getWorkItems.mock.calls[0][0]).toHaveLength(200);
    expect(getWorkItems.mock.calls[1][0]).toHaveLength(50);
  });

  test("PrQualityGateService paginates baseline failed results across >1000 items", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      testCase: { id: String(i + 1) },
      automatedTestName: `BaselineTest_${i + 1}`,
    }));
    const page2 = [
      {
        testCase: { id: "1001" },
        automatedTestName: "BaselineTest_1001",
      },
    ];

    const getTestResults = jest
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const mockTestApi = {
      queryTestRuns: jest.fn().mockResolvedValue([
        {
          id: 50,
          name: "Baseline Run",
          state: "Completed",
          completedDate: new Date().toISOString(),
        },
      ]),
      getTestResults,
    } as any;

    const service = new PrQualityGateService(mockTestApi, undefined, createMockLogger());
    const evaluation = await service.evaluateAndReport(
      [
        { testCaseId: "1001", testName: "BaselineTest_1001", outcome: "Failed", durationMs: 10 },
        { testCaseId: "2002", testName: "NewRegression", outcome: "Failed", durationMs: 10 },
      ],
      {
        project: "Proj",
        repositoryId: "repo",
        pullRequestId: 1,
        targetBranch: "refs/heads/main",
        sourceBranch: "refs/heads/feat",
      }
    );

    expect(getTestResults).toHaveBeenCalledTimes(2);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.newRegressions).toHaveLength(1);
    expect(evaluation.knownBaselineFailures).toHaveLength(1);
  });
});
