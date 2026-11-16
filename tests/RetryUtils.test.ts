import {
  clampMaxRetries,
  clampRetryBaseDelayMs,
  extractRetryAfterMs,
  extractStatusCode,
  isTransientError,
  withRetry,
  wrapClientWithRetry,
} from "../src/utils/RetryUtils";
import { ILogger } from "../src/interfaces/ILogger";

const createMockLogger = (): ILogger => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

describe("RetryUtils", () => {
  test("clampMaxRetries and clampRetryBaseDelayMs enforce safe bounds", () => {
    expect(clampMaxRetries(undefined)).toBe(3);
    expect(clampMaxRetries(-2)).toBe(0);
    expect(clampMaxRetries(99)).toBe(10);

    expect(clampRetryBaseDelayMs(undefined)).toBe(1000);
    expect(clampRetryBaseDelayMs(10)).toBe(100);
    expect(clampRetryBaseDelayMs(999999)).toBe(30000);
  });

  test("extractStatusCode and isTransientError classify errors accurately", () => {
    expect(extractStatusCode({ statusCode: 429 })).toBe(429);
    expect(extractStatusCode({ response: { status: 503 } })).toBe(503);

    expect(isTransientError({ statusCode: 429 })).toBe(true);
    expect(isTransientError({ statusCode: 502 })).toBe(true);
    expect(isTransientError({ statusCode: 503 })).toBe(true);
    expect(isTransientError({ code: "ECONNRESET" })).toBe(true);
    expect(isTransientError({ message: "socket hang up" })).toBe(true);

    expect(isTransientError({ statusCode: 400 })).toBe(false);
    expect(isTransientError({ statusCode: 401 })).toBe(false);
    expect(isTransientError({ statusCode: 404 })).toBe(false);
    expect(isTransientError({ statusCode: 409 })).toBe(false);
  });

  test("extractRetryAfterMs parses numeric seconds, HTTP-date, and caps at 60s", () => {
    expect(extractRetryAfterMs({ headers: { "Retry-After": "4" } })).toBe(4000);
    expect(extractRetryAfterMs({ response: { headers: { "retry-after": "120" } } })).toBe(60000);

    const now = Date.UTC(2026, 10, 16, 12, 0, 0);
    const futureDate = new Date(now + 15000).toUTCString();
    expect(extractRetryAfterMs({ headers: { "retry-after": futureDate } }, now)).toBe(15000);
  });

  test("withRetry respects 429 Retry-After and succeeds after transient failures", async () => {
    const delays: number[] = [];
    const logger = createMockLogger();
    let calls = 0;

    const result = await withRetry(
      async () => {
        calls++;
        if (calls === 1) {
          const err: any = new Error("Too Many Requests");
          err.statusCode = 429;
          err.headers = { "Retry-After": "7" };
          throw err;
        }
        if (calls === 2) {
          const err: any = new Error("Service Unavailable");
          err.statusCode = 503;
          throw err;
        }
        return "ok";
      },
      {
        maxRetries: 3,
        baseDelayMs: 500,
        logger,
        operationName: "testOp",
        random: () => 0,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }
    );

    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(delays).toEqual([7000, 1000]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  test("withRetry does not retry non-transient 4xx errors", async () => {
    const sleep = jest.fn();
    let calls = 0;

    await expect(
      withRetry(
        async () => {
          calls++;
          const err: any = new Error("Unauthorized");
          err.statusCode = 401;
          throw err;
        },
        { maxRetries: 3, sleep }
      )
    ).rejects.toThrow("Unauthorized");

    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("wrapClientWithRetry invokes method once on success and retries on transient failure", async () => {
    const delays: number[] = [];
    let getAttempts = 0;

    const rawClient = {
      syncHelper: (x: number) => x + 1,
      getItem: async (id: number) => {
        getAttempts++;
        if (getAttempts === 1) {
          const err: any = new Error("ECONNRESET");
          err.code = "ECONNRESET";
          throw err;
        }
        return { id };
      },
      getSuccess: jest.fn().mockResolvedValue({ ok: true }),
    };

    const wrapped = wrapClientWithRetry(rawClient, {
      maxRetries: 2,
      baseDelayMs: 200,
      random: () => 0,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(wrapped.syncHelper(41)).toBe(42);
    expect(await wrapped.getSuccess()).toEqual({ ok: true });
    expect(rawClient.getSuccess).toHaveBeenCalledTimes(1);

    expect(await wrapped.getItem(123)).toEqual({ id: 123 });
    expect(getAttempts).toBe(2);
    expect(delays).toEqual([200]);
  });
});
