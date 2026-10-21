import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db, withDbRetry } from "@/lib/db";
import { getAudioProgress, setAudioProgress } from "@/lib/redis";
import { safeSend } from "@/lib/inngest/client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { consumeCredits, creditsExhaustedResponse, CREDIT_COSTS } from "@/lib/credits";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Stuck-job thresholds. A podcast is ~23 TTS lines at 30-125s each, so a
// synthesis pass legitimately runs for 5-15 minutes — these cutoffs only
// trigger when the job has also stopped reporting progress.
const QUEUED_STALE_MS = 15 * 60 * 1000; // never picked up by the worker
const SYNTHESIZING_STALE_MS = 45 * 60 * 1000; // started but then died
const PROGRESS_STALE_MS = 2 * 60 * 1000; // no progress report for this long = stalled

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
  // This endpoint is polled every couple of seconds while a podcast is
  // generating, so a transient database blip must not turn into a stream of
  // failed polls (the client gives up after five and the panel freezes).
  const overview = await withDbRetry(() =>
    db.audioOverview.findFirst({
      where: { notebookId, sourceId: scopeSourceId || null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        errorMessage: true,
        script: true,
        durationSec: true,
        createdAt: true,
        updatedAt: true,
        sourceId: true,
        sourceTitle: true,
        audioUrl: true,
      },
    })
  );

  if (!overview) return NextResponse.json({ overview: null });

  const now = Date.now();
  let currentStatus = overview.status;
  let currentError = overview.errorMessage;

  // Live progress, if any. The pipeline writes a fresh `updatedAt` on every
  // step ("Recording line 7 of 23"), so it is the only reliable signal that a
  // long-running job is still making progress.
  const progress = await getAudioProgress(overview.id);
  const lastProgressAt = progress?.updatedAt ?? 0;
  const aliveMs = now - lastProgressAt;

  // Stuck job detection: mark an overview FAILED only when it has genuinely
  // stalled — no database write AND no progress report — long enough to
  // conclude nothing is running it.
  //
  // The thresholds are deliberately generous. A full podcast is ~23 TTS lines
  // at 30-125s each, so 5-15 minutes of synthesis is normal; the previous
  // 6-minute QUEUED cutoff marked healthy-but-slow jobs as failed, and the
  // pipeline never touched the row again during synthesis, so a job that was
  // actively recording looked identical to one that was never picked up.
  if (overview.updatedAt) {
    const updatedMs =
      overview.updatedAt instanceof Date ? overview.updatedAt.getTime() : new Date(overview.updatedAt).getTime();
    const ageMs = now - updatedMs;
    const isAlive = lastProgressAt > 0 && aliveMs < PROGRESS_STALE_MS;

    if (!isAlive && overview.status === "QUEUED" && ageMs > QUEUED_STALE_MS) {
      currentError =
        "The background worker (Inngest) didn't pick it up - make sure it is running";
    } else if (
      !isAlive &&
      (overview.status === "SCRIPTING" || overview.status === "SYNTHESIZING") &&
      ageMs > SYNTHESIZING_STALE_MS
    ) {
      currentError = "Audio generation timed out";
    }

    if (currentError && currentStatus !== "FAILED") {
      await withDbRetry(() =>
        db.audioOverview.update({
          where: { id: overview.id },
          data: { status: "FAILED", errorMessage: currentError },
        })
      ).catch(() => {
        // Best-effort: report the failure to the user even if it could not
        // be persisted.
      });
      await setAudioProgress(overview.id, {
        status: "FAILED",
        errorMessage: currentError,
        percent: 0,
        updatedAt: now,
      });
      currentStatus = "FAILED";
    }
  }

  return NextResponse.json({
    overview: {
      id: overview.id,
      status: currentStatus,
      errorMessage: currentError,
      script: overview.script,
      durationSec: overview.durationSec,
      createdAt: overview.createdAt,
      sourceId: overview.sourceId,
      sourceTitle: overview.sourceTitle,
      hasAudio: currentStatus === "READY",
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
      "Couldn't queue audio generation. If you're running locally, make sure `npx inngest-cli@latest dev` is running alongside `npm run dev` " +
      "(it also needs a moment to connect to the app after startup — try again in a minute if it just started); " +
      "in production, check INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY are set.";
    await withDbRetry(() =>
      db.audioOverview.update({ where: { id: overview.id }, data: { status: "FAILED", errorMessage } })
    ).catch(() => {});
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