import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getProgress } from "@/lib/redis";

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

  const progress = await getProgress(id);

  return NextResponse.json({
    status: raw.status,
    errorMessage: raw.errorMessage,
    chunkCount: raw.chunkCount,
    progress,
  });
}
