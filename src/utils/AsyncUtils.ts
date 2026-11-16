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
