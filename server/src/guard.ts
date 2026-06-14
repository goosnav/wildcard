// Server-side spend + abuse guard (REQ-NFR-006). Two mechanisms:
//
//  1. Per-user fixed-window RATE LIMITS on the expensive endpoints (generation
//     and the egress proxy), so one account can't hammer the model or upstreams.
//  2. A global per-period BUILD CEILING — a hard cap on how many tools we'll
//     generate per period across ALL users. This is the COGS backstop: each
//     shipped build is the unit of model spend, so capping builds caps the bill
//     even under a traffic spike or a credential leak.
//
// Everything here is IN-PROCESS, which is correct for the single-container v1
// deploy (one Node process serves the API). Horizontal scaling later needs a
// shared store (Redis/Postgres) so the counters are global — see DEPLOY.md.

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

/** A fixed-window counter keyed by an arbitrary string (e.g. a user id). Stale
 *  windows are pruned lazily so memory stays bounded without a timer. */
export class FixedWindow {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private sinceSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  check(key: string, now = Date.now()): RateResult {
    if (this.limit <= 0) return { ok: true, remaining: Infinity, retryAfterMs: 0 };
    this.maybeSweep(now);

    let w = this.hits.get(key);
    if (!w || now >= w.resetAt) {
      w = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, w);
    }
    if (w.count >= this.limit) {
      return { ok: false, remaining: 0, retryAfterMs: w.resetAt - now };
    }
    w.count++;
    return { ok: true, remaining: this.limit - w.count, retryAfterMs: 0 };
  }

  /** Drop expired windows every 256 checks — keeps the map from growing with
   *  one-off keys without the overhead (or shutdown hazard) of a setInterval. */
  private maybeSweep(now: number): void {
    if (++this.sinceSweep < 256) return;
    this.sinceSweep = 0;
    for (const [k, w] of this.hits) if (now >= w.resetAt) this.hits.delete(k);
  }
}

/** A global per-period ceiling using reserve/commit/release so concurrent
 *  requests can never overshoot the cap. Reserve a slot before doing expensive
 *  work; release it if the work fails (a failed build costs us nothing to ship,
 *  so it shouldn't consume the budget). limit <= 0 disables the ceiling. */
export class PeriodCeiling {
  private used = 0;
  private resetAt = 0;

  constructor(
    private readonly limit: number,
    private readonly periodMs: number
  ) {}

  private roll(now: number): void {
    if (now >= this.resetAt) {
      this.used = 0;
      this.resetAt = now + this.periodMs;
    }
  }

  get enabled(): boolean {
    return this.limit > 0;
  }

  /** Take a slot if capacity remains. Returns false when the period is full. */
  tryReserve(now = Date.now()): boolean {
    if (!this.enabled) return true;
    this.roll(now);
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }

  /** Hand a previously-reserved slot back (e.g. the build failed). */
  release(): void {
    if (this.enabled && this.used > 0) this.used--;
  }

  status(now = Date.now()): {
    limit: number | null;
    used: number;
    remaining: number | null;
    resetAt: number | null;
  } {
    if (!this.enabled) return { limit: null, used: 0, remaining: null, resetAt: null };
    this.roll(now);
    return {
      limit: this.limit,
      used: this.used,
      remaining: Math.max(0, this.limit - this.used),
      resetAt: this.resetAt,
    };
  }
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Per-user request rate limits (fixed 1-minute window). Tune via env; 0 = off.
export const generateLimiter = new FixedWindow(envInt("WC_RL_GENERATE_PER_MIN", 5), MINUTE);
export const netLimiter = new FixedWindow(envInt("WC_RL_NET_PER_MIN", 60), MINUTE);

// Global build ceiling per period (default 1000 builds / 24h; 0 = no cap).
export const buildCeiling = new PeriodCeiling(
  envInt("WC_BUILD_CEILING", 1000),
  envInt("WC_BUILD_CEILING_PERIOD_MS", DAY)
);

/** Snapshot for /health and the admin view — no secrets, just current pressure. */
export function guardStatus(): {
  buildCeiling: ReturnType<PeriodCeiling["status"]>;
} {
  return { buildCeiling: buildCeiling.status() };
}
