import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { clearRoadmapProgress } from "@/lib/redis";

async function ownedRoadmap(notebookId: string, roadmapId: string, userId: string) {
  const notebook = await db.notebook.findUnique({ where: { id: notebookId }, select: { ownerId: true } });
  if (!notebook || notebook.ownerId !== userId) return null;

  const roadmap = await db.roadmap.findUnique({ where: { id: roadmapId } });
  if (!roadmap || roadmap.notebookId !== notebookId) return null;

  return roadmap;
}

// DELETE removes a specific learning roadmap so the user can clear a stale
// or unwanted run and generate a fresh one. Mirrors the audio-overview
// delete route.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; roadmapId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: notebookId, roadmapId } = await params;

  const roadmap = await ownedRoadmap(notebookId, roadmapId, userId);
  if (!roadmap) return NextResponse.json({ error: "Roadmap not found" }, { status: 404 });

  await db.roadmap.delete({ where: { id: roadmapId } });
  await clearRoadmapProgress(roadmapId);

  return NextResponse.json({ success: true });
}