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

  // Cloudinary-backed audio: redirect to the public URL. Falls back to serving
  // the legacy in-Postgres bytes below for rows created before Cloudinary was wired
  // in (or if it wasn't configured at generation time).
  if (overview.audioUrl) {
    return NextResponse.redirect(overview.audioUrl, { status: 302 });
  }

  if (!overview.audioData) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }

  const total = overview.audioData.length;

  // Support HTTP Range requests so Safari / iOS can seek and resume playback.
  // Handles `bytes=a-b`, `bytes=a-`, and `bytes=-n`.
  const rangeHeader = _req.headers.get("range");
  if (rangeHeader) {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (match) {
      const startStr = match[1];
      const endStr = match[2];

      let rangeStart: number;
      let rangeEnd: number;

      if (startStr === "") {
        // `bytes=-n` — last n bytes
        const n = endStr ? parseInt(endStr, 10) : 0;
        if (!endStr || Number.isNaN(n) || n <= 0) {
          return new NextResponse(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${total}`,
              "Accept-Ranges": "bytes",
            },
          });
        }
        rangeStart = Math.max(0, total - n);
        rangeEnd = total - 1;
      } else {
        // `bytes=a-` or `bytes=a-b`
        const start = startStr ? parseInt(startStr, 10) : 0;
        if (!startStr || Number.isNaN(start) || start < 0 || start >= total) {
          return new NextResponse(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${total}`,
              "Accept-Ranges": "bytes",
            },
          });
        }
        rangeStart = start;
        rangeEnd = endStr && !Number.isNaN(parseInt(endStr, 10)) ? parseInt(endStr, 10) : total - 1;
      }

      rangeEnd = Math.min(rangeEnd, total - 1);
      const content = new Uint8Array(overview.audioData.subarray(rangeStart, rangeEnd + 1));

      return new NextResponse(content, {
        status: 206,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Disposition": `inline; filename="audio-overview-${audioId}.mp3"`,
          "Content-Range": `bytes ${rangeStart}-${rangeEnd}/${total}`,
          "Content-Length": String(rangeEnd - rangeStart + 1),
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      });
    }
  }

  return new NextResponse(new Uint8Array(overview.audioData), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": `inline; filename="audio-overview-${audioId}.mp3"`,
      "Content-Length": String(overview.audioData.length),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}