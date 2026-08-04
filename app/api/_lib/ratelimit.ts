/**
 * Minimal in-memory rate limiter for auth endpoints (brute-force/abuse guard).
 *
 * Not a subsystem — a single fixed-window counter keyed by a string (e.g.
 * IP+email). State is process-local and self-pruning. Good enough to blunt
 * credential stuffing on a single-node deployment; intentionally simple.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

/**
 * Fixed-window check. Returns ok=false once `limit` is exceeded within
 * `windowMs`. Each call that is allowed increments the counter.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }

  if (existing.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Best-effort client IP from standard proxy headers, falling back to a
 * constant so the limiter still functions when headers are absent.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

// Opportunistic pruning so the map cannot grow unbounded.
function prune() {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}
setInterval(prune, 5 * 60 * 1000).unref?.();
