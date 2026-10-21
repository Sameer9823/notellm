import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/lib/db";
import type { MessageDTO } from "@/types";

const querySchema = z.object({
  sourceId: z
    .string()
    .transform((s) => (s === "all" ? null : s))
    .optional()
    .nullable(),
   cursor: z.string().datetime().optional().nullable(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function toDto(m: {
  id: string;
  role: string;
  content: string;
  citations: unknown;
  sourceId: string | null;
  createdAt: Date;
}): MessageDTO {
  return {
    id: m.id,
    role: m.role === "USER" ? "USER" : "ASSISTANT",
    content: m.content,
    citations: Array.isArray(m.citations) ? (m.citations as MessageDTO["citations"]) : null,
    sourceId: m.sourceId,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: notebookId } = await params;
  const notebook = await db.notebook.findUnique({ where: { id: notebookId }, select: { ownerId: true } });
  if (!notebook || notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    sourceId: searchParams.get("sourceId"),
    cursor: searchParams.get("cursor"),
    limit: searchParams.get("limit"),
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { sourceId, cursor, limit } = parsed.data;

  // A non-"all" sourceId must belong to this notebook (and this owner).
  if (sourceId) {
    const owned = await db.source.findUnique({
      where: { id: sourceId },
      select: { notebookId: true, status: true },
    });
    if (!owned || owned.notebookId !== notebookId) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
  }

  const where = { notebookId, sourceId, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) };
  const rows = await db.message.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const nextCursor = rows.length === limit ? rows.at(-1)!.createdAt.toISOString() : null;
  const messages: MessageDTO[] = rows.map((m) => toDto(m));

  return NextResponse.json({ messages, nextCursor });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: notebookId } = await params;
  const notebook = await db.notebook.findUnique({ where: { id: notebookId }, select: { ownerId: true } });
  if (!notebook || notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const sourceIdRaw = searchParams.get("sourceId") ?? "all";
  const sourceId = sourceIdRaw === "all" ? null : sourceIdRaw;

  if (sourceId) {
    const owned = await db.source.findUnique({
      where: { id: sourceId },
      select: { notebookId: true },
    });
    if (!owned || owned.notebookId !== notebookId) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
  }

  const result = await db.message.deleteMany({ where: { notebookId, sourceId } });
  return NextResponse.json({ deleted: result.count });
}
