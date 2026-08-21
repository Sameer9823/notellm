import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; audioId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: notebookId, audioId } = await params;

  const notebook = await db.notebook.findUnique({ where: { id: notebookId }, select: { ownerId: true } });
  if (!notebook || notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const overview = await db.audioOverview.findUnique({ where: { id: audioId } });
  if (!overview || overview.notebookId !== notebookId) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }

  // Cloudinary-backed audio: redirect straight to the CDN URL instead of
  // proxying bytes through this route. Falls back to serving the legacy
  // in-Postgres bytes below for rows created before Cloudinary was wired
  // in (or if it wasn't configured at generation time).
  if (overview.audioUrl) {
    return NextResponse.redirect(overview.audioUrl, { status: 302 });
  }

  if (!overview.audioData) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(overview.audioData), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": `inline; filename="audio-overview-${audioId}.mp3"`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(overview.audioData.length),
    },
  });
}