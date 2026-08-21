import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { qdrant } from "@/lib/qdrant";
import { openai } from "@/lib/openai";

type CheckResult = { ok: boolean; latencyMs: number; error?: string };

async function timed(fn: () => Promise<unknown>): Promise<CheckResult> {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Pings every external dependency in parallel and reports which are up.
 *  Intentionally excluded from Clerk's protected-route matcher (see
 *  middleware.ts) so it can be hit by uptime monitors without auth. */
export async function GET() {
  const [postgres, redisCheck, qdrantCheck, openaiCheck] = await Promise.all([
    timed(() => db.$queryRaw`SELECT 1`),
    timed(() => redis.ping()),
    timed(() => qdrant.getCollections()),
    timed(() => openai.models.list()),
  ]);

  const checks = { postgres, redis: redisCheck, qdrant: qdrantCheck, openai: openaiCheck };
  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json({ ok: allOk, checks, checkedAt: new Date().toISOString() }, { status: allOk ? 200 : 503 });
}