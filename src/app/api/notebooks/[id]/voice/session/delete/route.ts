import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { redis } from "@/lib/redis";
import { db } from "@/lib/db";
import { activeSessionKey, releaseActiveSession } from "../session/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: notebookId } = await params;

  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  if (!notebook || notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const key = activeSessionKey(userId);
  const current = await redis.get(key);
  if (current) {
    await releaseActiveSession(userId, current);
  }

  return NextResponse.json({ released: !!current });
}
