import { redis } from "@/lib/redis";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfterSec: number;
};

/**
 * Fixed-window rate limiter backed by Redis (INCR + EXPIRE). Cheap, no
 * external dependency, good enough for per-user API throttling at this
 * scale — a sliding window isn't worth the extra Redis round trips here.
 *
 * `key` should already be scoped to both the user and the action, e.g.
 * `ratelimit:chat:${userId}`, so different actions don't share a budget.
 *
 * Fails OPEN: if Redis is unreachable, the request is allowed through
 * rather than blocked, since Redis is treated as disposable everywhere
 * else in this codebase (see lib/redis.ts) and a rate limiter going down
 * shouldn't take the product down with it.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSec);
    }
    const ttl = count === 1 ? windowSec : await redis.ttl(key);
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSec: ttl > 0 ? ttl : windowSec,
    };
  } catch {
    return { allowed: true, limit, remaining: limit, retryAfterSec: 0 };
  }
}

/** Per-action limits, tuned to cost/abuse risk rather than one blanket number. */
export const RATE_LIMITS = {
  // Chat hits OpenAI on every message — the highest-frequency, highest-cost path.
  chat: { limit: 20, windowSec: 60 },
  // Source upload triggers extraction + embeddings for potentially large files.
  sourceUpload: { limit: 10, windowSec: 60 },
  // Audio/roadmap generation are the most expensive single actions (multiple
  // LLM calls + TTS), so they get the tightest budget.
  audioGenerate: { limit: 5, windowSec: 60 * 10 },
  roadmapGenerate: { limit: 5, windowSec: 60 * 10 },
  // Artifact generation is a single (usually structured-output) LLM call —
  // cheaper than audio/roadmap but still metered separately from chat.
  artifactGenerate: { limit: 10, windowSec: 60 * 10 },
  // Review answers are cheap DB writes, not LLM calls — generous budget.
  reviewAnswer: { limit: 120, windowSec: 60 },
  // Tavily search — cheap relative to actually adding sources, but still
  // metered separately so it can't be hammered to probe the query API.
  webSearch: { limit: 15, windowSec: 60 },
   // Web preview embeddability check + reader extraction — each is an
   // outbound fetch, so cap per-user to avoid abuse as an SSRF oracle.
   webPreview: { limit: 15, windowSec: 60 },
   // Screenshot generation — expensive external API + bandwidth.
   screenshot: { limit: 5, windowSec: 60 },
   memoryWrite: { limit: 20, windowSec: 60 },
  // IP-based limits for public/unauthenticated routes (applied in middleware).
  // These are generous — the goal is abuse prevention, not quota enforcement.
  ipPublic: { limit: 300, windowSec: 60 },
  ipHealth: { limit: 600, windowSec: 60 },
  ipBillingWebhook: { limit: 300, windowSec: 60 },
  // Per-user limits for mutation-heavy / quota-sensitive routes.
  sourceReindex: { limit: 3, windowSec: 60 },
  notebookMutate: { limit: 10, windowSec: 60 },
  shareToggle: { limit: 10, windowSec: 60 },
  notes: { limit: 30, windowSec: 60 },
  voiceMessages: { limit: 20, windowSec: 60 },
  billingCheckout: { limit: 5, windowSec: 60 },
  billingPortal: { limit: 5, windowSec: 60 },
} as const;

/** Builds a standard 429 response with the headers clients expect. */
export function rateLimitResponse(result: RateLimitResult) {
  return Response.json(
    { error: "Too many requests — slow down and try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    }
  );
}