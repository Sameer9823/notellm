import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getRoadmapProgress, setRoadmapProgress } from "@/lib/redis";
import { MIN_VIDEOS_FOR_ROADMAP } from "@/lib/roadmap-pipeline";
import { safeSend } from "@/lib/inngest/client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { consumeCredits, creditsExhaustedResponse, CREDIT_COSTS } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function ownedNotebook(id: string, userId: string) {
  const notebook = await db.notebook.findUnique({ where: { id } });
  if (!notebook || notebook.ownerId !== userId) return null;
  return notebook;
}

// GET returns the latest roadmap for this notebook (nodes/edges + live
// progress), if one exists, plus how many indexed YouTube sources are
// currently linked (so the client can gate the "generate" button and warn
// when a roadmap is stale relative to newly added videos).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: notebookId } = await params;

  if (!(await ownedNotebook(notebookId, userId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const [roadmap, videoCount] = await Promise.all([
    db.roadmap.findFirst({
      where: { notebookId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        errorMessage: true,
        nodes: true,
        edges: true,
        sourceCount: true,
        createdAt: true,
      },
    }),
    db.source.count({ where: { notebookId, type: "YOUTUBE", status: "READY" } }),
  ]);

  if (!roadmap) return NextResponse.json({ roadmap: null, videoCount });

  const progress = await getRoadmapProgress(roadmap.id);

  return NextResponse.json({
    roadmap: {
      id: roadmap.id,
      status: roadmap.status,
      errorMessage: roadmap.errorMessage,
      nodes: roadmap.nodes,
      edges: roadmap.edges,
      sourceCount: roadmap.sourceCount,
      createdAt: roadmap.createdAt,
    },
    progress,
    videoCount,
  });
}

// POST kicks off a new generation run across every READY YouTube source
// currently linked in the notebook. Prior roadmaps are left in history;
// the client treats the newest as current, same as audio overviews.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { limit, windowSec } = RATE_LIMITS.roadmapGenerate;
  const rl = await checkRateLimit(`ratelimit:roadmap:${userId}`, limit, windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  const { id: notebookId } = await params;

  if (!(await ownedNotebook(notebookId, userId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const videoCount = await db.source.count({ where: { notebookId, type: "YOUTUBE", status: "READY" } });
  if (videoCount < MIN_VIDEOS_FOR_ROADMAP) {
    return NextResponse.json(
      { error: `Link at least ${MIN_VIDEOS_FOR_ROADMAP} indexed YouTube videos before generating a roadmap` },
      { status: 400 }
    );
  }

  // Charged only now that there are enough videos to actually run —
  // clustering + labeling is a multi-call LLM pipeline, same cost tier as
  // audio generation.
  const spend = await consumeCredits(userId, CREDIT_COSTS.roadmapGenerate);
  if (!spend.allowed) return creditsExhaustedResponse(spend.status);

  const roadmap = await db.roadmap.create({ data: { notebookId, status: "QUEUED" } });
  await setRoadmapProgress(roadmap.id, { status: "QUEUED", percent: 0, updatedAt: Date.now() });

  // Run as a durable Inngest job (retries + step checkpointing), same
  // pattern as ingest, audio, and artifact generation — the POST returns
  // instantly, progress is polled from Redis/Postgres by the client.
  const queued = await safeSend({ name: "roadmap/generate", data: { roadmapId: roadmap.id } });
  if (!queued) {
    const errorMessage =
      "Couldn't queue roadmap generation. If you're running locally, make sure `npx inngest-cli@latest dev` is running alongside `npm run dev`; in production, check INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY are set.";
    await db.roadmap.update({ where: { id: roadmap.id }, data: { status: "FAILED", errorMessage } }).catch(() => {});
    await setRoadmapProgress(roadmap.id, { status: "FAILED", percent: 0, updatedAt: Date.now(), errorMessage });
  }

  return NextResponse.json(
    { roadmap: { id: roadmap.id, status: roadmap.status } },
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