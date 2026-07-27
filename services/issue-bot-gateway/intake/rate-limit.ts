import type { D1DatabaseLike } from "./status-store.js";

export interface QuotaPolicy {
  cooldownMs: number;
  perHour: number;
  perDay: number;
  globalActive: number;
  globalPerDay: number;
}

export const DEFAULT_QUOTA_POLICY: QuotaPolicy = Object.freeze({
  cooldownMs: 30_000,
  perHour: 5,
  perDay: 20,
  globalActive: 10,
  globalPerDay: 400,
});

export interface QuotaLimiter { reserve(bucketHash: string, now: number): Promise<boolean>; release?(bucketHash: string, now: number): Promise<void> }

function hourWindow(now: number): string { return new Date(now).toISOString().slice(0, 13); }
function dayWindow(now: number): string { return new Date(now).toISOString().slice(0, 10); }

/**
 * All counters use keyed bucket hashes. Conditional upserts make each counter limit
 * atomic in D1; failed multi-counter reservations are compensated before returning.
 */
export class D1QuotaLimiter implements QuotaLimiter {
  constructor(private readonly db: D1DatabaseLike, private readonly policy: QuotaPolicy = DEFAULT_QUOTA_POLICY) {}

  async reserve(bucketHash: string, now: number): Promise<boolean> {
    const recent = await this.db.prepare("SELECT created_at FROM submissions WHERE ip_bucket_hash = ? AND model_bound = 1 AND created_at >= ? LIMIT 1")
      .bind(bucketHash, now - this.policy.cooldownMs).first<{ created_at: number }>();
    if (recent) return false;

    const slots: Array<[string, string, number]> = [
      [bucketHash, "active", 1],
      ["global", "active", this.policy.globalActive],
      [bucketHash, `hour:${hourWindow(now)}`, this.policy.perHour],
      [bucketHash, `day:${dayWindow(now)}`, this.policy.perDay],
      ["global", `day:${dayWindow(now)}`, this.policy.globalPerDay],
    ];
    const reserved: Array<[string, string]> = [];
    for (const [scope, window, limit] of slots) {
      if (!await this.increment(scope, window, limit, now)) {
        await Promise.all(reserved.map(([reservedScope, reservedWindow]) => this.decrement(reservedScope, reservedWindow, now)));
        return false;
      }
      reserved.push([scope, window]);
    }
    return true;
  }

  async release(bucketHash: string, now: number): Promise<void> {
    await Promise.all([
      this.decrement(bucketHash, "active", now), this.decrement("global", "active", now),
      this.decrement(bucketHash, `hour:${hourWindow(now)}`, now), this.decrement(bucketHash, `day:${dayWindow(now)}`, now),
      this.decrement("global", `day:${dayWindow(now)}`, now),
    ]);
  }

  private async increment(bucketHash: string, windowKind: string, limit: number, now: number): Promise<boolean> {
    const result = await this.db.prepare(`INSERT INTO quota_counters (bucket_hash, window_kind, count, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(bucket_hash, window_kind) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
      WHERE quota_counters.count < ?`).bind(bucketHash, windowKind, now, limit).run();
    return (result.meta?.changes ?? 0) === 1;
  }

  private async decrement(bucketHash: string, windowKind: string, now: number): Promise<void> {
    await this.db.prepare("UPDATE quota_counters SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END, updated_at = ? WHERE bucket_hash = ? AND window_kind = ?")
      .bind(now, bucketHash, windowKind).run();
  }
}
