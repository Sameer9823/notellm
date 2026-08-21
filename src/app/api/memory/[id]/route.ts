import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { updateMemory, deleteMemory } from "@/lib/memory";
import { z } from "zod";

const bodySchema = z.object({ memory: z.string().min(1).max(1000) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const memory = await updateMemory(userId, id, parsed.data.memory);
    return NextResponse.json({ memory });
  } catch {
    return NextResponse.json({ error: "Memory not found" }, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    await deleteMemory(userId, id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Memory not found" }, { status: 404 });
  }
}
