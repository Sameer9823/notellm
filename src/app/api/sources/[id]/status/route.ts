import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getProgress, setProgress } from "@/lib/redis";

// How long a source can sit in QUEUED before we conclude the background worker
// never picked it up and surface a recoverable failure instead of letting the
// UI spinner run forever. Matches the 15s maxDuration of the reindex route.
const QUEUED_STALE_MS = 2 * 60 * 1000;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const raw = await db.source.findUnique({ where: { id } });
  if (!raw) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const notebook = await db.notebook.findUnique({ where: { id: raw.notebookId }, select: { ownerId: true } });
  if (!notebook || notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  // Recovery for sources that enqueued but the worker never claimed. If this
  // stays QUEUED past the window we mark it FAILED with a retryable message
  // and stop the UI from polling indefinitely.
  if (raw.status === "QUEUED") {
    const queuedAge = Date.now() - raw.updatedAt.getTime();
    if (queuedAge > QUEUED_STALE_MS) {
      const errorMessage =
        "Background worker did not pick up this job. Check Inngest setup, then retry via reindex.";
      await db.source
        .update({ where: { id }, data: { status: "FAILED", errorMessage } })
        .catch(() => {});
      await setProgress(id, { status: "FAILED", percent: 0, updatedAt: Date.now(), errorMessage }).catch(() => {});
      return NextResponse.json({
        status: "FAILED",
        errorMessage,
        chunkCount: raw.chunkCount,
        progress: null,
      });
    }
  }

  const progress = await getProgress(id);

  return NextResponse.json({
    status: raw.status,
    errorMessage: raw.errorMessage,
    chunkCount: raw.chunkCount,
    progress,
  });
}
