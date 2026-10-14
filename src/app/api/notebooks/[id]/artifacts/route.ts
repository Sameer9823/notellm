import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { setArtifactProgress, getArtifactProgress } from "@/lib/redis";
import { safeSend } from "@/lib/inngest/client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { consumeCredits, creditsExhaustedResponse, CREDIT_COSTS, refundCredits } from "@/lib/credits";
import { z } from "zod";

async function ownedNotebook(id: string, userId: string) {
  const notebook = await db.notebook.findUnique({ where: { id } });
  if (!notebook || notebook.ownerId !== userId) return null;
  return notebook;
}

// GET lists every artifact generated for this notebook, newest first, with
// live generation progress attached for any still QUEUED/GENERATING.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: notebookId } = await params;

  if (!(await ownedNotebook(notebookId, userId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const artifacts = await db.artifact.findMany({
    where: { notebookId },
    orderBy: { createdAt: "desc" },
  });

  const withProgress = await Promise.all(
    artifacts.map(async (a: (typeof artifacts)[number]) => ({ ...a, progress: await getArtifactProgress(a.id) }))
  );

  return NextResponse.json({ artifacts: withProgress });
}

const bodySchema = z.object({
  type: z.enum(["SUMMARY", "TAKEAWAYS", "FLASHCARDS", "QUIZ", "MINDMAP", "REPORT"]),
  sourceIds: z.array(z.string().min(1)).max(50).optional(),
  title: z.string().max(200).optional(),
});

const TYPE_LABELS: Record<string, string> = {
  SUMMARY: "Summary",
  TAKEAWAYS: "Key takeaways",
  FLASHCARDS: "Flashcards",
  QUIZ: "Quiz",
  MINDMAP: "Mind map",
  REPORT: "Report",
};

// POST kicks off a new artifact generation run.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { limit, windowSec } = RATE_LIMITS.artifactGenerate;
  const rl = await checkRateLimit(`ratelimit:artifact:${userId}`, limit, windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  const { id: notebookId } = await params;
  if (!(await ownedNotebook(notebookId, userId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const readyCount = await db.source.count({
    where: {
      notebookId,
      status: "READY",
      ...(parsed.data.sourceIds?.length ? { id: { in: parsed.data.sourceIds } } : {}),
    },
  });
  if (readyCount === 0) {
    return NextResponse.json(
      { error: "Add and index at least one source before generating a study artifact" },
      { status: 400 }
    );
  }

  const spend = await consumeCredits(userId, CREDIT_COSTS.artifactGenerate);
  if (!spend.allowed) return creditsExhaustedResponse(spend.status);

  const artifact = await db.artifact.create({
    data: {
      notebookId,
      type: parsed.data.type,
      title: parsed.data.title?.trim() || TYPE_LABELS[parsed.data.type],
      status: "QUEUED",
      sourceIds: parsed.data.sourceIds ?? [],
    },
  });

  await setArtifactProgress(artifact.id, { status: "QUEUED", percent: 0, updatedAt: Date.now() });

  // Run generation as a durable Inngest job, same pattern as ingest/audio/roadmap.
  const queued = await safeSend({ name: "artifact/generate", data: { artifactId: artifact.id } });
  if (!queued) {
    const errorMessage =
      "Couldn't queue artifact generation. If you're running locally, make sure `npx inngest-cli@latest dev` is running alongside `npm run dev`; in production, check INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY are set.";
    await db.artifact.update({ where: { id: artifact.id }, data: { status: "FAILED", errorMessage } }).catch(() => {});
    await setArtifactProgress(artifact.id, { status: "FAILED", percent: 0, updatedAt: Date.now(), errorMessage });
    // The credit was consumed above but no job was queued — refund it.
    void refundCredits(userId, CREDIT_COSTS.artifactGenerate);
  }

  return NextResponse.json(
    { artifact: { id: artifact.id, status: artifact.status, type: artifact.type, title: artifact.title } },
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
