import { ILogger } from "../interfaces/ILogger";
import { SecretRedactor } from "./SecretRedactor";

export const DEFAULT_MAX_RETRIES = 3;
export const MIN_MAX_RETRIES = 0;
export const MAX_MAX_RETRIES = 10;

export const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
export const MIN_RETRY_BASE_DELAY_MS = 100;
export const MAX_RETRY_BASE_DELAY_MS = 30000;

export const MAX_RETRY_AFTER_MS = 60000;

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxRetryAfterMs?: number;
  logger?: ILogger;
  operationName?: string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export function clampMaxRetries(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_RETRIES;
  }
  const rounded = Math.floor(value);
  return Math.max(MIN_MAX_RETRIES, Math.min(MAX_MAX_RETRIES, rounded));
}

export function clampRetryBaseDelayMs(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_RETRY_BASE_DELAY_MS;
  }
  const rounded = Math.floor(value);
  return Math.max(MIN_RETRY_BASE_DELAY_MS, Math.min(MAX_RETRY_BASE_DELAY_MS, rounded));
}

export function extractStatusCode(err: any): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const candidate =
    err.statusCode ??
    err.status ??
    err.response?.statusCode ??
    err.response?.status;
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function getHeaderCaseInsensitive(headers: any, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) {
      const val = headers[key];
      if (Array.isArray(val)) return val[0] !== undefined ? String(val[0]) : undefined;
      if (val !== undefined && val !== null) return String(val);
    }
  }
  return undefined;
}

export function extractRetryAfterMs(
  err: any,
  nowMs: number = Date.now(),
  capMs: number = MAX_RETRY_AFTER_MS
): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const raw =
    getHeaderCaseInsensitive(err.headers, "retry-after") ??
    getHeaderCaseInsensitive(err.response?.headers, "retry-after") ??
    getHeaderCaseInsensitive(err.result?.headers, "retry-after");

  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Numeric seconds
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(capMs, Math.round(seconds * 1000));
    }
  }

  // HTTP-date
  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    const delta = Math.max(0, parsedDate - nowMs);
    return Math.min(capMs, delta);
  }

  return undefined;
}

export function isTransientError(err: any): boolean {
  if (!err) return false;
  const status = extractStatusCode(err);
  if (status !== undefined) {
    return RETRYABLE_STATUS_CODES.has(status);
  }

  const code = err.code || err.cause?.code;
  if (typeof code === "string" && RETRYABLE_ERROR_CODES.has(code.toUpperCase())) {
    return true;
  }

  const msg = typeof err.message === "string" ? err.message.toLowerCase() : "";
  if (
    msg.includes("socket hang up") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("network timeout") ||
    msg.includes("rate limit")
  ) {
    return true;
  }

  return false;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = clampMaxRetries(options.maxRetries);
  const baseDelayMs = clampRetryBaseDelayMs(options.baseDelayMs);
  const maxRetryAfterMs = options.maxRetryAfterMs ?? MAX_RETRY_AFTER_MS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt >= maxRetries || !isTransientError(err)) {
        throw err;
      }

      const retryAfterMs = extractRetryAfterMs(err, Date.now(), maxRetryAfterMs);
      const exponentialMs = baseDelayMs * Math.pow(2, attempt);
      const jitterMs = Math.floor(random() * Math.min(250, exponentialMs * 0.25));
      const delayMs =
        retryAfterMs !== undefined
          ? retryAfterMs
          : Math.min(maxRetryAfterMs, exponentialMs + jitterMs);

      attempt++;
      const status = extractStatusCode(err);
      const reason = status ? `HTTP ${status}` : err?.code || err?.message || "transient error";
      const opLabel = options.operationName ? ` (${options.operationName})` : "";
      options.logger?.warn(
        SecretRedactor.redact(
          `⏳ ADO API transient failure${opLabel}: ${reason}. Retrying attempt ${attempt}/${maxRetries} in ${delayMs}ms...`
        )
      );

      await sleep(delayMs);
    }
  }
}

export function wrapClientWithRetry<T extends object>(
  client: T,
  options: RetryOptions = {}
): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: any[]) => {
        const result = value.apply(target, args);
        if (result && typeof result.then === "function") {
          let firstAttempt = true;
          return withRetry(
            () => {
              if (firstAttempt) {
                firstAttempt = false;
                return result;
              }
              return value.apply(target, args);
            },
            {
              ...options,
              operationName: options.operationName || String(prop),
            }
          );
        }
        return result;
      };
    },
  });
}
