import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { qdrant, COLLECTION } from "@/lib/qdrant";

/** Cache TTL in seconds for readiness results. */
const CACHE_TTL = 15;
const CACHE_KEY = "health:ready:cache";

type CheckResult = { ok: boolean; latencyMs: number };

async function timed(fn: () => Promise<unknown>): Promise<CheckResult> {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

/**
 * Readiness probe — checks Postgres, Redis, and Qdrant.
 *
 * Requires an `x-health-token` header matching the `HEALTH_TOKEN` env var so
 * it isn't an unauthenticated oracle into infrastructure state. Results are
 * cached for 15 seconds in Redis to avoid hammering backends on every poll.
 * Raw error messages are never returned to the caller — only ok/latency;
 * failures are logged server-side.
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get("x-health-token");
  const expectedToken = process.env.HEALTH_TOKEN;
  if (!expectedToken || token !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Try cache first if Redis is in a usable state.
  if (redis.status === "ready") {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as { ok: boolean; checks: Record<string, CheckResult>; ts: number };
        if (Date.now() - parsed.ts < CACHE_TTL * 1000) {
          return NextResponse.json({ ok: parsed.ok, checks: parsed.checks, cached: true });
        }
      }
    } catch {
      // cache miss is fine — fall through to live checks
    }
  }

  const [postgres, redisCheck, qdrantCheck] = await Promise.all([
    timed(() => db.$queryRaw`SELECT 1`),
    timed(() => redis.ping()),
    timed(async () => {
      // ensureCollection has a module-level guard so this is cheap on repeat
      await qdrant.getCollections();
    }),
  ]);

  const checks = { postgres, redis: redisCheck, qdrant: qdrantCheck };
  const allOk = postgres.ok && redisCheck.ok && qdrantCheck.ok;

  // Cache the result.
  const payload = { ok: allOk, checks, ts: Date.now() };
  try {
    await redis.set(CACHE_KEY, JSON.stringify(payload), "EX", CACHE_TTL);
  } catch {
    // caching is best-effort
  }

  // Log failures server-side (never leak raw errors to the caller).
  if (!allOk) {
    const failing = Object.entries(checks).filter(([, c]) => !c.ok);
    console.error(
      "[health/ready] failing checks:",
      failing.map(([name]) => name).join(", ")
    );
  }

  return NextResponse.json(
    { ok: allOk, checks: stripErrors(checks), cached: false },
    { status: allOk ? 200 : 503 }
  );
}

/** Strips any error detail from check results — readiness responses must
 *  never leak internal error messages to potential attackers. */
function stripErrors(checks: Record<string, CheckResult>): Record<string, CheckResult> {
  const clean: Record<string, CheckResult> = {};
  for (const [k, v] of Object.entries(checks)) {
    clean[k] = { ok: v.ok, latencyMs: v.latencyMs };
  }
  return clean;
}
