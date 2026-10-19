// Простой лимитер «скользящее окно» в памяти (один процесс API).

export interface RateLimiter {
  /** true — запрос допущен, false — лимит исчерпан */
  take(key: string): boolean;
}

export function createRateLimiter(opts: { max: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const hits = new Map<string, number[]>();
  let sweepAt = now() + opts.windowMs;

  return {
    take(key: string): boolean {
      const t = now();
      if (t >= sweepAt) {
        for (const [k, arr] of hits) {
          if (arr.length === 0 || (arr[arr.length - 1] ?? 0) <= t - opts.windowMs) hits.delete(k);
        }
        sweepAt = t + opts.windowMs;
      }
      const arr = (hits.get(key) ?? []).filter((x) => x > t - opts.windowMs);
      if (arr.length >= opts.max) {
        hits.set(key, arr);
        return false;
      }
      arr.push(t);
      hits.set(key, arr);
      return true;
    },
  };
}
