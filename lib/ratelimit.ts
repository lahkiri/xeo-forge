/**
 * Rate limiting for expensive and abusable paths.
 *
 * WHY THIS LIVES IN lib/ RATHER THAN app/api/_lib/: the limiter is not only an
 * HTTP concern. The `http_request` agent tool needs the same counter, and
 * `lib/agent/*` must not import from `app/*` — that would invert the dependency
 * direction and drag route-layer code into the agent runtime. So the one
 * implementation lives here and `app/api/_lib/ratelimit.ts` re-exports it for
 * the routes. There is exactly one limiter instance either way.
 *
 * SCOPE AND CEILING: the default limiter is a fixed-window counter in this
 * process's memory. On a single node that is enough to blunt credential
 * stuffing and runaway task creation. It is NOT enough behind more than one
 * instance — each replica counts separately, so N replicas means N times the
 * limit. That is a deliberate trade (single-process by decision, no Redis), and
 * the seam for changing it is the `RateLimiter` interface: pass a
 * Redis/Postgres-backed implementation to `setRateLimiter()` and every call site
 * is fixed at once, because they all go through `rateLimit()`.
 */

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets. 0 when the call was allowed. */
  retryAfterSec: number;
}

export interface RateLimiter {
  /**
   * Consume one unit against `key`. Returns ok=false once `limit` is exceeded
   * inside `windowMs`. Refused calls must NOT extend the window — otherwise a
   * client hammering the endpoint locks itself out indefinitely instead of
   * recovering when the window rolls over.
   */
  check(key: string, limit: number, windowMs: number): RateLimitResult;
}

type Bucket = { count: number; resetAt: number };

export class InMemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor() {
    // Opportunistic pruning so the map cannot grow unbounded across many keys.
    // unref() so this timer never holds a process (or a test run) open.
    const timer = setInterval(() => this.prune(), 5 * 60 * 1000);
    timer.unref?.();
  }

  check(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, retryAfterSec: 0 };
    }

    if (existing.count >= limit) {
      return {
        ok: false,
        retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.count += 1;
    return { ok: true, retryAfterSec: 0 };
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.buckets) {
      if (v.resetAt <= now) this.buckets.delete(k);
    }
  }
}

let limiter: RateLimiter = new InMemoryRateLimiter();

/** Replace the limiter (shared store, tests). One seam, one call site to change. */
export function setRateLimiter(next: RateLimiter): void {
  limiter = next;
}

/** Restore the process-local default. Used by tests to undo setRateLimiter. */
export function resetRateLimiter(): void {
  limiter = new InMemoryRateLimiter();
}

/** Fixed-window check against the active limiter. */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  return limiter.check(key, limit, windowMs);
}

/**
 * Client identity for rate-limit keying on unauthenticated routes.
 *
 * `x-forwarded-for` is only honored when TRUST_PROXY=1. Any client can send
 * that header, so trusting it unconditionally — as this used to — hands out an
 * unlimited supply of distinct buckets and makes the limiter decorative. Set
 * TRUST_PROXY=1 only when a proxy you control rewrites the header on every
 * inbound request.
 *
 * Authenticated routes should key on the user id instead: a session is a
 * stronger identity than any header, and it cannot be rotated for free.
 */
export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY === '1') {
    const xff = req.headers.get('x-forwarded-for');
    if (xff) {
      // Right-most entry is the one appended by the nearest trusted proxy;
      // everything to its left is client-supplied and forgeable.
      const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
    const real = req.headers.get('x-real-ip')?.trim();
    if (real) return real;
  }
  // Next.js does not expose the socket address on the Request object. Without a
  // trusted proxy we deliberately fall back to a single shared bucket: a global
  // cap is a real (if blunt) limit, whereas a forgeable per-header key is none.
  return 'shared';
}

/** Every ceiling in the app, declared in one place instead of inlined at call sites. */
export const RATE_LIMITS = {
  /** Credential stuffing. Keyed by IP — the caller has no session yet. */
  login: { limit: 10, windowMs: 5 * 60 * 1000 },
  register: { limit: 5, windowMs: 10 * 60 * 1000 },
  /** Task creation starts an agent run: credits, provider calls, host work. */
  taskCreate: { limit: 30, windowMs: 5 * 60 * 1000 },
  /** Each accepted message can resume a run. */
  taskMessage: { limit: 60, windowMs: 60 * 1000 },
  /** Probes an external provider with a real key — spend amplifier if unbounded. */
  modelTest: { limit: 10, windowMs: 60 * 1000 },
  /** Outbound fetch driven by the model. Keyed per task, not per user. */
  httpTool: { limit: 60, windowMs: 60 * 1000 },
} as const;
