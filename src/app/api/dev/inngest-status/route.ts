import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { getInngestStatus } from "@/lib/inngest/client";
import { pingRedis } from "@/lib/redis";

/**
 * Dev-only diagnostics endpoint that surfaces what the Inngest enqueue path
 * actually sees: is the dev server reachable, did it register the app, and is
 * Redis healthy. Intended for debugging "sources stuck in QUEUED".
 *
 * Returns a 404 in production so it can never leak diagnostics from a
 * deployed instance.
 */
export async function GET(_req: NextRequest) {
  if (serverEnv.isProduction) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  const inngest = await getInngestStatus();
  const redisPing = await pingRedis();

  return NextResponse.json({
    inngest,
    redis: {
      // Reveal only the scheme (redacted) — never a full URL with credentials.
      urlScheme: serverEnv.redis.url.split(":")[0] ?? "unknown",
      ping: redisPing,
    },
    // Booleans only — never the actual secret values.
    env: {
      INNGEST_DEV: Boolean(process.env.INNGEST_DEV),
      INNGEST_BASE_URL: Boolean(process.env.INNGEST_BASE_URL),
      INNGEST_EVENT_KEY: Boolean(process.env.INNGEST_EVENT_KEY),
      INNGEST_SIGNING_KEY: Boolean(process.env.INNGEST_SIGNING_KEY),
    },
  });
}
