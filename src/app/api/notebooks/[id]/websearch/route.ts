import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { setProgress } from "@/lib/redis";
import { safeSend } from "@/lib/inngest/client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { consumeCredits, creditsExhaustedResponse, CREDIT_COSTS } from "@/lib/credits";
import { tavilySearch } from "@/lib/tavily";

async function ownedNotebook(id: string, userId: string) {
  const notebook = await db.notebook.findUnique({ where: { id } });
  if (!notebook || notebook.ownerId !== userId) return null;
  return notebook;
}

const searchSchema = z.object({ query: z.string().min(2).max(300) });
const addSchema = z.object({
  results: z
    .array(z.object({ url: z.string().url(), title: z.string().min(1).max(200) }))
    .min(1)
    .max(8),
});

/**
 * GET-like search step: takes a query, returns candidate URLs via Tavily.
 * Nothing is persisted yet — the client shows these as checkable results
 * and calls PUT below with the ones the user actually picked.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: notebookId } = await params;
  if (!(await ownedNotebook(notebookId, userId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const rl = await checkRateLimit(`ratelimit:websearch:${userId}`, RATE_LIMITS.webSearch.limit, RATE_LIMITS.webSearch.windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  const parsed = searchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const results = await tavilySearch(parsed.data.query, 6);
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Web search failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * Add step: takes the results the user picked from POST above and creates
 * a normal URL source per pick, reusing the exact same ingest pipeline
 * (extractUrl -> chunk -> embed) that a manually-pasted link goes through.
 * One credit charge per source, same as /sources, checked up front so a
 * partial batch can't leave the user's balance in a confusing state.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: notebookId } = await params;
  if (!(await ownedNotebook(notebookId, userId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const rl = await checkRateLimit(`ratelimit:upload:${userId}`, RATE_LIMITS.sourceUpload.limit, RATE_LIMITS.sourceUpload.windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const created: { id: string; title: string }[] = [];
  let lastStatus: Awaited<ReturnType<typeof consumeCredits>>["status"] | null = null;

  for (const result of parsed.data.results) {
    const spend = await consumeCredits(userId, CREDIT_COSTS.sourceUpload);
    if (!spend.allowed) {
      // Stop adding once credits run out, but keep whatever was already
      // created rather than failing the whole batch.
      lastStatus = spend.status;
      break;
    }
    lastStatus = spend.status;

    const source = await db.source.create({
      data: {
        notebookId,
        type: "URL",
        title: result.title || result.url,
        status: "QUEUED",
        originUrl: result.url,
      },
    });

    await setProgress(source.id, { status: "QUEUED", percent: 0, updatedAt: Date.now() });
    const queued = await safeSend({ name: "source/created", data: { sourceId: source.id } });
    if (!queued) {
      const errorMessage =
        "Couldn't queue this source for processing. If you're running locally, make sure `npx inngest-cli@latest dev` is running alongside `npm run dev`; in production, check INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY are set.";
      await db.source.update({ where: { id: source.id }, data: { status: "FAILED", errorMessage } }).catch(() => {});
      await setProgress(source.id, { status: "FAILED", percent: 0, updatedAt: Date.now(), errorMessage });
    }
    created.push({ id: source.id, title: source.title });
  }

  if (created.length === 0) {
    return lastStatus ? creditsExhaustedResponse(lastStatus) : NextResponse.json({ error: "Nothing was added" }, { status: 400 });
  }

  await db.notebook.update({ where: { id: notebookId }, data: { updatedAt: new Date() } });

  return NextResponse.json(
    { created, skipped: parsed.data.results.length - created.length },
    {
      status: 201,
      headers: lastStatus
        ? {
            "X-Credits-Balance": String(lastStatus.balance),
            "X-Credits-Max": String(lastStatus.max),
            "X-Credits-Reset": String(lastStatus.resetAt),
          }
        : undefined,
    }
  );
}
