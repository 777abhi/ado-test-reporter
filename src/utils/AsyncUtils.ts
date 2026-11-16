export const DEFAULT_CONCURRENCY = 5;
export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 20;

export const DEFAULT_BATCH_SIZE = 200;
export const MIN_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 1000;
export const MAX_WORK_ITEM_BATCH_SIZE = 200;

export function clampConcurrency(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_CONCURRENCY;
  }
  const rounded = Math.floor(value);
  return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, rounded));
}

export function clampBatchSize(value?: number, max: number = MAX_BATCH_SIZE): number {
  if (value === undefined || !Number.isFinite(value)) {
    return Math.min(DEFAULT_BATCH_SIZE, max);
  }
  const rounded = Math.floor(value);
  return Math.max(MIN_BATCH_SIZE, Math.min(max, rounded));
}

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) return [];
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Maps over items with bounded concurrency while preserving input order.
 * Fails fast if `fn` throws (callers wanting per-item isolation should catch inside `fn`).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const limit = Math.min(clampConcurrency(concurrency), items.length);
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) {
        return;
      }
      results[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);
  return results;
}

export interface PagedResult<T> extends Array<T> {
  continuationToken?: string;
}

export const DEFAULT_MAX_PAGES = 100;

/**
 * Fetches all pages from an ADO `PagedList<T>` endpoint using continuationToken,
 * with duplicate-token and maxPages guards against infinite loops.
 */
export async function fetchAllPages<T>(
  fetchPage: (continuationToken?: string) => Promise<PagedResult<T> | T[] | undefined | null>,
  maxPages: number = DEFAULT_MAX_PAGES
): Promise<T[]> {
  const all: T[] = [];
  const seenTokens = new Set<string>();
  let continuationToken: string | undefined = undefined;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const page = await fetchPage(continuationToken);
    pageCount++;

    if (!page || page.length === 0) {
      const nextToken = (page as PagedResult<T> | undefined)?.continuationToken;
      if (!nextToken || seenTokens.has(nextToken)) {
        break;
      }
      seenTokens.add(nextToken);
      continuationToken = nextToken;
      continue;
    }

    all.push(...page);
    const nextToken = (page as PagedResult<T>).continuationToken;
    if (!nextToken || seenTokens.has(nextToken)) {
      break;
    }
    seenTokens.add(nextToken);
    continuationToken = nextToken;
  }

  return all;
}

/**
 * Fetches all pages from a `skip`/`top` paginated endpoint, stopping when a page
 * returns fewer than `pageSize` items or `maxPages` is reached.
 */
export async function fetchAllSkipTop<T>(
  fetchPage: (skip: number, top: number) => Promise<T[] | undefined | null>,
  pageSize: number = 1000,
  maxPages: number = DEFAULT_MAX_PAGES
): Promise<T[]> {
  const all: T[] = [];
  const effectivePageSize = Math.max(1, Math.floor(pageSize));
  let skip = 0;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const page = await fetchPage(skip, effectivePageSize);
    pageCount++;

    if (!page || page.length === 0) {
      break;
    }

    all.push(...page);
    if (page.length < effectivePageSize) {
      break;
    }
    skip += page.length;
  }

  return all;
}
