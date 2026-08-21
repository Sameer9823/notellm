import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { z } from "zod";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notebooks = await db.notebook.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { sources: true } } },
  });

  return NextResponse.json({ notebooks });
}

const createSchema = z.object({
  title: z.string().min(1).max(120).default("Untitled notebook"),
  description: z.string().max(500).optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(20).optional(),
});

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const notebook = await db.notebook.create({
    data: { ownerId: userId, ...parsed.data },
  });

  return NextResponse.json({ notebook }, { status: 201 });
}
