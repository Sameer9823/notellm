import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

async function ownedNote(id: string, userId: string) {
  const note = await db.note.findUnique({ where: { id }, include: { notebook: true } });
  if (!note || note.notebook.ownerId !== userId) return null;
  return note;
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const note = await ownedNote(id, userId);
  if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  await db.note.delete({ where: { id } });

  return NextResponse.json({ success: true });
}