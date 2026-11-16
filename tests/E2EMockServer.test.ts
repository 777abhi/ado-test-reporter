import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { AzureClientProvider } from "../src/AzureClientProvider";
import { TestCaseService } from "../src/testCaseService";
import { TestPlanService } from "../src/testPlanService";
import { FailureTaskService } from "../src/failureTaskService";
import { JUnitParser } from "../src/junitParser";
import { App } from "../src/App";
import { ILogger } from "../src/interfaces/ILogger";

const createMockLogger = (): ILogger => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const ROUTE_LOCATIONS = [
  {
    id: "e81700f7-3be2-46de-8624-2eb35882fcaa",
    area: "Location",
    resourceName: "ResourceAreas",
    routeTemplate: "_apis/resourceAreas/{areaId}",
    minVersion: "3.2",
    maxVersion: "7.2",
    releasedVersion: "7.1",
  },
  {
    id: "0e292477-a0c2-47f3-a9b6-34f153d627f4",
    area: "TestPlan",
    resourceName: "Plans",
    routeTemplate: "{project}/_apis/testplan/plans/{planId}",
    minVersion: "5.0",
    maxVersion: "7.2",
    releasedVersion: "7.1",
  },
  {
    id: "1046d5d3-ab61-4ca7-a65a-36118a978256",
    area: "TestPlan",
    resourceName: "Suites",
    routeTemplate: "{project}/_apis/testplan/Plans/{planId}/suites/{suiteId}",
    minVersion: "5.0",
    maxVersion: "7.2",
    releasedVersion: "7.1",
  },
  {
    id: "52df686e-bae4-4334-b0ee-b6cf4e6f6b73",
    area: "TestPlan",
    resourceName: "Points",
    routeTemplate: "{project}/_apis/testplan/Plans/{planId}/Suites/{suiteId}/point/{pointId}",
    minVersion: "5.0",
    maxVersion: "7.2",
    releasedVersion: "7.1",
  },
  {
    id: "a4a1ec1c-b03f-41ca-8857-704594ecf58e",
    area: "Test",
    resourceName: "TestCases",
    routeTemplate: "{project}/_apis/test/Plans/{planId}/Suites/{suiteId}/testcases/{testCaseIds}",
    minVersion: "5.0",
    maxVersion: "7.2",
    releasedVersion: "7.1",
  },
  {
    id: "cadb3810-d47d-4a3c-a234-fe5f3be50138",
    area: "Test",
    resourceName: "Runs",
    routeTemplate: "{project}/_apis/test/runs/{runId}",
    minVersion: "5.0",
    maxVersion: "7.2",
    releasedVersion: "7.1",
  },
  {
    id: "4637d869-3a76-4468-8057-0bb02aa385cf",
    area: "Test",
    resourceName: "Results",
    routeTemplate: "{project}/_apis/test/Runs/{runId}/results",
    minVersion: "5.0",
    maxVersion: "7.2",
    releasedVersion: "7.1",
  },
  {
    id: "72c7ddf8-2cdc-4f60-90cd-ab71c14a399b",
    area: "wit",
    resourceName: "workItems",
    routeTemplate: "{project}/_apis/wit/workitems/{id}",
    minVersion: "5.0",
    maxVersion: "7.2",
    releasedVersion: "7.1",
  },
  {
    id: "62d3d110-0047-428c-ad3c-4fe872c91c74",
    area: "wit",
    resourceName: "workItems",
    routeTemplate: "{project}/_apis/wit/workitems/${type}",
    minVersion: "5.0",
    maxVersion: "7.2",
    releasedVersion: "7.1",
  },
  {
    id: "1a9c53f7-f243-4447-b110-35ef023636e4",
    area: "wit",
    resourceName: "wiql",
    routeTemplate: "{project}/_apis/wit/wiql/{id}",
    minVersion: "5.0",
    maxVersion: "7.2",
    releasedVersion: "7.1",
  },
];

describe("E2E Mock ADO HTTP Server", () => {
  let server: http.Server;
  let baseUrl: string;
  let prevNoProxy: string | undefined;
  let prevHttpProxy: string | undefined;
  let prevHttpsProxy: string | undefined;
  let tmpDir: string;

  const stats = {
    getWorkItemsCalls: 0,
    pointsCalls: 0,
    addResultsBatches: [] as number[],
    rateLimitedOnce: false,
    createdFailureTasks: 0,
  };

  beforeAll(async () => {
    prevNoProxy = process.env.NO_PROXY;
    prevHttpProxy = process.env.HTTP_PROXY;
    prevHttpsProxy = process.env.HTTPS_PROXY;
    process.env.NO_PROXY = "127.0.0.1,localhost";
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;

    tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-e2e-"));

    server = http.createServer((req, res) => {
      const urlObj = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = urlObj.pathname;

      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const bodyStr = Buffer.concat(chunks).toString("utf8");

        const sendJson = (status: number, data: any, headers: Record<string, string> = {}) => {
          res.writeHead(status, {
            "Content-Type": "application/json",
            ...headers,
          });
          res.end(JSON.stringify(data));
        };

        if (req.method === "OPTIONS" && pathname.includes("_apis")) {
          return sendJson(200, { count: ROUTE_LOCATIONS.length, value: ROUTE_LOCATIONS });
        }

        if (pathname.startsWith("/_apis/resourceAreas")) {
          return sendJson(200, []);
        }

        if (pathname.endsWith("/_apis/connectionData")) {
          return sendJson(200, { authenticatedUser: { id: "e2e-user" } });
        }

        // Test Plans
        if (pathname.endsWith("/_apis/testplan/plans")) {
          return sendJson(200, {
            count: 1,
            value: [{ id: 10, name: "E2E Plan", rootSuite: { id: 100 } }],
          });
        }

        // Test Suites
        if (pathname.includes("/_apis/testplan/Plans/10/suites")) {
          return sendJson(200, {
            count: 1,
            value: [{ id: 20, name: "E2E Suite" }],
          });
        }

        // Suite Test Cases
        if (pathname.includes("/_apis/test/Plans/10/Suites/20/testcases")) {
          return sendJson(200, {
            count: 3,
            value: [
              { testCase: { id: "101" } },
              { testCase: { id: "102" } },
              { testCase: { id: "103" } },
            ],
          });
        }

        // Points List
        if (pathname.includes("/_apis/testplan/Plans/10/Suites/20/point")) {
          stats.pointsCalls++;
          return sendJson(200, {
            count: 3,
            value: [
              { id: 1001, testCaseReference: { id: "101", name: "Login_Pass_TC101" } },
              { id: 1002, testCaseReference: { id: "102", name: "Cart_Pass_TC102" } },
              { id: 1003, testCaseReference: { id: "103", name: "Checkout_Fail_TC103" } },
            ],
          });
        }

        // Batch Work Items (simulate 429 Retry-After on first call!)
        if (pathname.endsWith("/_apis/wit/workitems") && req.method === "GET") {
          stats.getWorkItemsCalls++;
          if (!stats.rateLimitedOnce) {
            stats.rateLimitedOnce = true;
            return sendJson(
              429,
              { message: "Rate limit exceeded" },
              { "Retry-After": "0" }
            );
          }
          const ids = (urlObj.searchParams.get("ids") || "")
            .split(",")
            .filter(Boolean)
            .map((s) => Number(s));
          return sendJson(200, {
            count: ids.length,
            value: ids.map((id) => ({
              id,
              rev: 2,
              fields: { "System.Title": `TC_${id}` },
            })),
          });
        }

        // WIQL for failure task deduplication
        if (pathname.endsWith("/_apis/wit/wiql") && req.method === "POST") {
          return sendJson(200, { workItems: [] });
        }

        // Create failure task
        if (pathname.includes("/_apis/wit/workitems/$") && req.method === "POST") {
          stats.createdFailureTasks++;
          return sendJson(200, {
            id: 900 + stats.createdFailureTasks,
            rev: 1,
            fields: { "System.Title": "Failure Task" },
          });
        }

        // Create Test Run
        if (pathname.endsWith("/_apis/test/runs") && req.method === "POST") {
          return sendJson(200, { id: 777, name: "E2E Run", state: "InProgress" });
        }

        // Add Test Results (chunked)
        if (pathname.endsWith("/_apis/test/Runs/777/results") && req.method === "POST") {
          const parsed = JSON.parse(bodyStr || "[]");
          stats.addResultsBatches.push(parsed.length);
          return sendJson(200, {
            count: parsed.length,
            value: parsed.map((_: any, i: number) => ({ id: stats.addResultsBatches.length * 10 + i })),
          });
        }

        // Update Test Run
        if (pathname.endsWith("/_apis/test/runs/777") && req.method === "PATCH") {
          return sendJson(200, { id: 777, state: "Completed" });
        }

        return sendJson(404, { message: `Unhandled mock route: ${req.method} ${pathname}` });
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (prevNoProxy !== undefined) process.env.NO_PROXY = prevNoProxy;
    else delete process.env.NO_PROXY;
    if (prevHttpProxy !== undefined) process.env.HTTP_PROXY = prevHttpProxy;
    if (prevHttpsProxy !== undefined) process.env.HTTPS_PROXY = prevHttpsProxy;

    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("executes full App.run() over HTTP with 429 retry, prefetch, pagination, chunking, and failure task creation", async () => {
    const junitPath = path.join(tmpDir, "e2e-results.xml");
    fs.writeFileSync(
      junitPath,
      `<testsuites>
        <testsuite name="E2E" tests="3" failures="1">
          <testcase name="Login_Pass_TC101" time="0.1"/>
          <testcase name="Cart_Pass_TC102" time="0.2"/>
          <testcase name="Checkout_Fail_TC103" time="0.3">
            <failure message="500 Internal Server Error">Stack trace</failure>
          </testcase>
        </testsuite>
      </testsuites>`
    );

    const logger = createMockLogger();
    const provider = new AzureClientProvider();
    const clients = await provider.createClients("dummy-pat-token", baseUrl, "pat", logger, {
      maxRetries: 2,
      baseDelayMs: 100,
    });

    const testCaseService = new TestCaseService(clients.workItemApi, "Proj", false, false, logger);
    const testPlanService = new TestPlanService(
      clients.testApi,
      clients.testPlanApi,
      "Proj",
      baseUrl,
      false,
      false,
      logger
    );
    const failureTaskService = new FailureTaskService(
      clients.workItemApi,
      "Proj",
      baseUrl,
      logger,
      "Task"
    );

    const app = new App(testCaseService, testPlanService, failureTaskService, new JUnitParser(), logger);
    const summary = await app.run(
      {
        planName: "E2E Plan",
        suiteName: "E2E Suite",
        buildId: 42,
        buildNumber: "2026.11.16.1",
        attachResults: false,
        createFailureTasks: true,
        autoCloseOnPass: false,
        concurrency: 2,
        batchSize: 2,
        auditEvidenceOutput: path.join(tmpDir, "audit.json"),
      },
      junitPath
    );

    expect(summary?.runId).toBe(777);
    expect(summary?.results).toHaveLength(3);
    expect(stats.rateLimitedOnce).toBe(true);
    expect(stats.getWorkItemsCalls).toBe(3); // batch 1 [101,102] (429 + retry) + batch 2 [103]
    expect(stats.pointsCalls).toBe(1);
    expect(stats.addResultsBatches).toEqual([2, 1]); // batchSize=2 chunked 3 results
    expect(stats.createdFailureTasks).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 429"));
  });
});
