import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getArtifactProgress } from "@/lib/redis";

async function ownedArtifact(notebookId: string, artifactId: string, userId: string) {
  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  if (!notebook || notebook.ownerId !== userId) return null;
  const artifact = await db.artifact.findUnique({ where: { id: artifactId } });
  if (!artifact || artifact.notebookId !== notebookId) return null;
  return artifact;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: notebookId, artifactId } = await params;

  const artifact = await ownedArtifact(notebookId, artifactId, userId);
  if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });

  const progress = await getArtifactProgress(artifact.id);
  return NextResponse.json({ artifact, progress });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: notebookId, artifactId } = await params;

  const artifact = await ownedArtifact(notebookId, artifactId, userId);
  if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });

  await db.artifact.delete({ where: { id: artifact.id } });
  return NextResponse.json({ success: true });
}
