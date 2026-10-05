import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const saveSchema = z.object({
  role: z.enum(["USER", "ASSISTANT"]),
  content: z.string().min(1).max(5000),
  citations: z.array(
    z.object({
      marker: z.number(),
      chunkId: z.string(),
      sourceId: z.string(),
      sourceTitle: z.string(),
      sourceType: z.string(),
      page: z.number().nullable().optional(),
      startSec: z.number().nullable().optional(),
      endSec: z.number().nullable().optional(),
      snippet: z.string(),
    })
  ).optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: notebookId } = await params;

  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  if (!notebook || notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const message = await db.message.create({
    data: {
      notebookId,
      role: parsed.data.role,
      content: parsed.data.content,
      citations: parsed.data.citations ? JSON.parse(JSON.stringify(parsed.data.citations)) : null,
      channel: "VOICE",
    },
  });

  return NextResponse.json({ id: message.id }, { status: 201 });
}
