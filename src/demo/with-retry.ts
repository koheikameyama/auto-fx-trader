// Ported from auto-us-stock-trader/src/paper-trading/with-retry.ts.
// This repo has no prior retry/timeout convention; introduced deliberately
// here because a live broker call failing transiently should not be treated
// the same as a real rejection.
export interface RetryOptions {
  retries: number;
  intervalMs: number;
  onError?: (err: unknown, attempt: number) => void;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      opts.onError?.(e, attempt);
      if (attempt < opts.retries) {
        await new Promise((r) => setTimeout(r, opts.intervalMs));
      }
    }
  }
  throw lastErr;
}
