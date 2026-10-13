import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const source = await db.source.findUnique({
    where: { id },
    include: {
      notebook: { select: { ownerId: true } },
      chunks: { orderBy: { index: "asc" } },
      sourceFile: { select: { id: true } },
    },
  });

  if (!source || source.notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  const highlightChunkId = req.nextUrl.searchParams.get("chunkId");

  return NextResponse.json({
    source: {
      id: source.id,
      type: source.type,
      title: source.title,
      originUrl: source.originUrl,
      pageCount: source.pageCount,
      durationSec: source.durationSec,
      language: source.language,
      metadata: source.metadata,
      hasFile: source.type === "PDF" && (!!source.storagePath || !!source.sourceFile),
    },
    chunks: source.chunks.map(
      (c: {
        id: string;
        index: number;
        content: string;
        page: number | null;
        startSec: number | null;
        endSec: number | null;
        startChar: number | null;
        endChar: number | null;
      }) => ({
        id: c.id,
        index: c.index,
        content: c.content,
        page: c.page,
        startSec: c.startSec,
        endSec: c.endSec,
        startChar: c.startChar,
        endChar: c.endChar,
      })
    ),
    highlightChunkId,
  });
}