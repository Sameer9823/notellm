import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { clearAudioProgress } from "@/lib/redis";
import { destroyAsset } from "@/lib/cloudinary";

async function ownedOverview(notebookId: string, audioId: string, userId: string) {
  const notebook = await db.notebook.findUnique({ where: { id: notebookId }, select: { ownerId: true } });
  if (!notebook || notebook.ownerId !== userId) return null;

  const overview = await db.audioOverview.findUnique({ where: { id: audioId } });
  if (!overview || overview.notebookId !== notebookId) return null;

  return overview;
}

// DELETE removes a specific audio overview (script + generated MP3) so the
// user can clear a bad/old take and generate a fresh one. Mirrors the
// roadmap delete route below it in the tree.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; audioId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: notebookId, audioId } = await params;

  const overview = await ownedOverview(notebookId, audioId, userId);
  if (!overview) return NextResponse.json({ error: "Audio overview not found" }, { status: 404 });

  await db.audioOverview.delete({ where: { id: audioId } });
  await clearAudioProgress(audioId);

  // Best-effort cleanup of the Cloudinary asset — an orphaned file there
  // costs storage, not correctness, so this never blocks the response.
  if (overview.audioPublicId) {
    destroyAsset(overview.audioPublicId, "video").catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[audio] Failed to delete Cloudinary asset ${overview.audioPublicId}:`, err);
    });
  }

  return NextResponse.json({ success: true });
}