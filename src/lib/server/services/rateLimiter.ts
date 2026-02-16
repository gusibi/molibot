export class RateLimiter {
  private buckets = new Map<string, number[]>();

  constructor(private readonly maxPerMinute: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - 60_000;
    const bucket = this.buckets.get(key) ?? [];
    const fresh = bucket.filter((ts) => ts > cutoff);

    if (fresh.length >= this.maxPerMinute) {
      this.buckets.set(key, fresh);
      return false;
    }

    fresh.push(now);
    this.buckets.set(key, fresh);
    return true;
  }
}
