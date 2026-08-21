import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listUserMemories, createMemory } from "@/lib/memory";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { z } from "zod";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memories = await listUserMemories(userId);
  return NextResponse.json({ memories });
}

const bodySchema = z.object({ memory: z.string().min(1).max(1000) });

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { limit, windowSec } = RATE_LIMITS.memoryWrite;
  const rl = await checkRateLimit(`ratelimit:memory:${userId}`, limit, windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const memory = await createMemory(userId, parsed.data.memory, "MANUAL");
  return NextResponse.json({ memory }, { status: 201 });
}
