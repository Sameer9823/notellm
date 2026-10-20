import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { deleteBySource, updateSourceTitle } from "@/lib/qdrant";
import { destroyAsset } from "@/lib/cloudinary";

async function ownedSource(id: string, userId: string) {
  const source = await db.source.findUnique({ where: { id }, include: { notebook: true } });
  if (!source || source.notebook.ownerId !== userId) return null;
  return source;
}

const renameSchema = z.object({ title: z.string().trim().min(1).max(160) });

/** Renames a source. Also patches the title already baked into this
 *  source's Qdrant chunk payloads (best-effort) so future chat citations
 *  and the "All sources" search show the new name instead of the one
 *  captured at ingest time. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const source = await ownedSource(id, userId);
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updated = await db.source.update({ where: { id }, data: { title: parsed.data.title } });
  await updateSourceTitle(id, parsed.data.title).catch(() => undefined);

  return NextResponse.json({ source: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const source = await ownedSource(id, userId);
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  await deleteBySource(id).catch(() => undefined);
  await db.source.delete({ where: { id } });

  // Best-effort cleanup of Cloudinary assets. An orphaned asset costs
  // storage, not correctness, so these never block the response.
  if (source.storagePublicId) {
    destroyAsset(source.storagePublicId, "raw").catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[sources] Failed to delete Cloudinary asset ${source.storagePublicId}:`, err);
    });
  }
  if (source.snapshotPublicId) {
    destroyAsset(source.snapshotPublicId, "image").catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[sources] Failed to delete Cloudinary snapshot ${source.snapshotPublicId}:`, err);
    });
  }

  // Deleting a source cascades (via the Message.sourceId relation) that
  // source's own scoped chat messages — but MUST NOT touch any other
  // messages (including the notebook's "All sources" chat at sourceId=null).
  // The relation cascade above handles scoped messages; we deliberately omit
  // the old notebook-wide message wipe, which previously deleted every chat.
  const remaining = await db.source.count({ where: { notebookId: source.notebookId } });
  if (remaining === 0) {
    await Promise.all([
      db.note.deleteMany({ where: { notebookId: source.notebookId } }),
      db.roadmap.deleteMany({ where: { notebookId: source.notebookId } }),
      db.audioOverview.deleteMany({ where: { notebookId: source.notebookId } }),
    ]);
  }

  return NextResponse.json({ success: true, notebookCleared: remaining === 0 });
}