import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

interface ChunkRow {
  id: string;
  index: number;
  content: string;
  page: number | null;
  startSec: number | null;
  endSec: number | null;
  startChar: number | null;
  endChar: number | null;
}

function serializeChunk(c: ChunkRow) {
  return {
    id: c.id,
    index: c.index,
    content: c.content,
    page: c.page,
    startSec: c.startSec,
    endSec: c.endSec,
    startChar: c.startChar,
    endChar: c.endChar,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const source = await db.source.findUnique({
    where: { id },
    include: {
      notebook: { select: { ownerId: true } },
      sourceFile: { select: { id: true } },
    },
  });

  if (!source || source.notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  const highlightChunkId = req.nextUrl.searchParams.get("chunkId");
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam))) : 50;

  const baseSource = {
    id: source.id,
    type: source.type,
    title: source.title,
    originUrl: source.originUrl,
    pageCount: source.pageCount,
    durationSec: source.durationSec,
    language: source.language,
    metadata: source.metadata,
    hasFile: source.type === "PDF" && (!!source.storagePath || !!source.sourceFile),
  };

  // ── ChunkId mode: return the target chunk ±2 neighbors ──
  if (highlightChunkId) {
    const target = await db.chunk.findFirst({
      where: { id: highlightChunkId, sourceId: id },
      select: { index: true },
    });

    if (!target) {
      return NextResponse.json({
        source: baseSource,
        chunks: [],
        highlightChunkId,
      });
    }

    const windowSize = 2;
    const chunks = await db.chunk.findMany({
      where: { sourceId: id, index: { gte: target.index - windowSize, lte: target.index + windowSize } },
      orderBy: { index: "asc" },
    });

    return NextResponse.json({
      source: baseSource,
      chunks: chunks.map(serializeChunk),
      highlightChunkId,
    });
  }

  // ── Paginated mode: cursor-based pagination on chunk.index ──
  const cursorParam = req.nextUrl.searchParams.get("cursor");
  const cursor = cursorParam ? Number(cursorParam) : undefined;

  const where = {
    sourceId: id,
    ...(cursor !== undefined ? { index: { gt: cursor } } : {}),
  };

  const chunks = await db.chunk.findMany({
    where,
    orderBy: { index: "asc" },
    take: limit + 1,
  });

  const hasMore = chunks.length > limit;
  const page = hasMore ? chunks.slice(0, -1) : chunks;
  const nextCursor = hasMore ? String(page[page.length - 1].index) : null;

  return NextResponse.json({
    source: baseSource,
    chunks: page.map(serializeChunk),
    nextCursor,
  });
}
