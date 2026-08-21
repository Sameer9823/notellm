import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { z } from "zod";

async function ownedNotebook(id: string, userId: string) {
  const notebook = await db.notebook.findUnique({ where: { id } });
  if (!notebook || notebook.ownerId !== userId) return null;
  return notebook;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const notebook = await db.notebook.findUnique({
    where: { id },
    include: {
      sources: { orderBy: { createdAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!notebook || notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  return NextResponse.json({ notebook });
}

const updateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(20).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  if (!(await ownedNotebook(id, userId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const notebook = await db.notebook.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ notebook });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  if (!(await ownedNotebook(id, userId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  // Cascade removes sources/chunks/messages in Postgres; vector cleanup is
  // best-effort since Qdrant has no FK cascade of its own.
  const sources = await db.source.findMany({ where: { notebookId: id }, select: { id: true } });
  const { deleteBySource } = await import("@/lib/qdrant");
  await Promise.all(sources.map((s: { id: string }) => deleteBySource(s.id).catch(() => undefined)));

  await db.notebook.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
