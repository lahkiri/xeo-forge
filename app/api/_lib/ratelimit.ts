/**
 * Route-layer re-export of the single rate limiter.
 *
 * The implementation lives in `lib/ratelimit.ts` because the `http_request`
 * agent tool needs the same counter, and `lib/agent/*` must not import from
 * `app/*`. This file exists so route code can keep importing from `_lib`
 * alongside `respond.ts` — it adds nothing and holds no state of its own.
 */

export {
  rateLimit,
  clientIp,
  setRateLimiter,
  resetRateLimiter,
  RATE_LIMITS,
  InMemoryRateLimiter,
} from '@/lib/ratelimit';
export type { RateLimiter, RateLimitResult } from '@/lib/ratelimit';
