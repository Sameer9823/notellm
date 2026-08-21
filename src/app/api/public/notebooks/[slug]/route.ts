import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Deliberately outside /api/notebooks and NOT covered by the auth
// middleware's protected-route matcher — this is the one read path in the
// app that's meant to work without a Clerk session. It only ever reads
// (never mutates) and only ever returns notebooks the owner explicitly
// flagged isPublic, via /api/notebooks/[id]/share.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const notebook = await db.notebook.findUnique({
    where: { shareSlug: slug },
    select: {
      id: true,
      title: true,
      description: true,
      icon: true,
      color: true,
      isPublic: true,
      updatedAt: true,
      sources: {
        where: { status: "READY" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          title: true,
          originUrl: true,
          pageCount: true,
          durationSec: true,
          chunkCount: true,
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, citations: true, createdAt: true },
      },
    },
  });

  // Same 404 whether the slug doesn't exist or sharing was turned off —
  // don't leak which case it is.
  if (!notebook || !notebook.isPublic) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { isPublic: _isPublic, ...publicNotebook } = notebook;
  return NextResponse.json({ notebook: publicNotebook });
}