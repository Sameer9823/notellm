import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getAudioProgress, setAudioProgress } from "@/lib/redis";
import { safeSend } from "@/lib/inngest/client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { consumeCredits, creditsExhaustedResponse, CREDIT_COSTS } from "@/lib/credits";
import { z } from "zod";

async function ownedNotebook(id: string, userId: string) {
  const notebook = await db.notebook.findUnique({ where: { id } });
  if (!notebook || notebook.ownerId !== userId) return null;
  return notebook;
}

// GET returns the latest audio overview for this notebook (metadata + script
// + live progress), if one exists. The binary MP3 itself is served
// separately from /audio/file to keep this response small and pollable.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: notebookId } = await params;

  if (!(await ownedNotebook(notebookId, userId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const { searchParams } = new URL(_req.url);
  const scopeSourceId = searchParams.get("sourceId");

  // Latest overview matching the requested scope (a specific source, or
  // notebook-wide when no sourceId is given) — falls back to notebook-wide
  // history is kept separate per scope so switching the active source
  // doesn't show a stale "All sources" (or another source's) podcast.
  const overview = await db.audioOverview.findFirst({
    where: { notebookId, sourceId: scopeSourceId || null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      errorMessage: true,
      script: true,
      durationSec: true,
      createdAt: true,
      sourceId: true,
      sourceTitle: true,
      audioData: true, // only used to compute a boolean below, not sent to client
      audioUrl: true,
    },
  });

  if (!overview) return NextResponse.json({ overview: null });

  const progress = await getAudioProgress(overview.id);

  return NextResponse.json({
    overview: {
      id: overview.id,
      status: overview.status,
      errorMessage: overview.errorMessage,
      script: overview.script,
      durationSec: overview.durationSec,
      createdAt: overview.createdAt,
      sourceId: overview.sourceId,
      sourceTitle: overview.sourceTitle,
      hasAudio: overview.audioData != null || overview.audioUrl != null,
    },
    progress,
  });
}

const bodySchema = z.object({
  voiceA: z.string().max(30).optional(),
  voiceB: z.string().max(30).optional(),
  sourceId: z.string().min(1).nullable().optional(),
});

// POST kicks off a new generation run. Any prior overview for this notebook
// (in the same scope) is left in place in history but the client should
// treat the newest as current — simplest correct behavior without adding a
// "regenerate" verb.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { limit, windowSec } = RATE_LIMITS.audioGenerate;
  const rl = await checkRateLimit(`ratelimit:audio:${userId}`, limit, windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  const { id: notebookId } = await params;

  if (!(await ownedNotebook(notebookId, userId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  let scopeSource: { id: string; title: string } | null = null;
  if (parsed.data.sourceId) {
    const source = await db.source.findUnique({
      where: { id: parsed.data.sourceId },
      select: { id: true, title: true, notebookId: true, status: true },
    });
    if (!source || source.notebookId !== notebookId) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    if (source.status !== "READY") {
      return NextResponse.json({ error: "This source hasn't finished indexing yet" }, { status: 400 });
    }
    scopeSource = { id: source.id, title: source.title };
  } else {
    const readyCount = await db.source.count({ where: { notebookId, status: "READY" } });
    if (readyCount === 0) {
      return NextResponse.json({ error: "Add and index at least one source before generating an audio overview" }, { status: 400 });
    }
  }

  // Charged only now that the request is known-valid — audio generation is
  // one of the most expensive actions (multiple LLM calls + TTS), same
  // reasoning RATE_LIMITS.audioGenerate already uses for its tight budget.
  const spend = await consumeCredits(userId, CREDIT_COSTS.audioGenerate);
  if (!spend.allowed) return creditsExhaustedResponse(spend.status);

  const overview = await db.audioOverview.create({
    data: {
      notebookId,
      status: "QUEUED",
      voiceA: parsed.data.voiceA || "alloy",
      voiceB: parsed.data.voiceB || "onyx",
      sourceId: scopeSource?.id ?? null,
      sourceTitle: scopeSource?.title ?? null,
    },
  });

  await setAudioProgress(overview.id, { status: "QUEUED", percent: 0, updatedAt: Date.now() });

  // Run generation after the response is sent so the request returns
  // instantly while scripting/TTS happens in the background (visible via
  // polling), same pattern as source ingestion.
  // Durable job via Inngest (retries + step checkpointing), instead of a
  // fire-and-forget `after()` call — see src/lib/inngest/functions.ts.
  const queued = await safeSend({ name: "audio/generate", data: { audioOverviewId: overview.id } });
  if (!queued) {
    const errorMessage =
      "Couldn't queue audio generation. If you're running locally, make sure `npx inngest-cli@latest dev` is running alongside `npm run dev`; in production, check INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY are set.";
    await db.audioOverview.update({ where: { id: overview.id }, data: { status: "FAILED", errorMessage } }).catch(() => {});
    await setAudioProgress(overview.id, { status: "FAILED", percent: 0, updatedAt: Date.now(), errorMessage });
  }

  return NextResponse.json(
    { overview: { id: overview.id, status: overview.status } },
    {
      status: 201,
      headers: {
        "X-Credits-Balance": String(spend.status.balance),
        "X-Credits-Max": String(spend.status.max),
        "X-Credits-Reset": String(spend.status.resetAt),
      },
    }
  );
}