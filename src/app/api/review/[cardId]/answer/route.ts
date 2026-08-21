import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { submitReview, submitQuizAnswer } from "@/lib/review";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { z } from "zod";

// FLASHCARD cards are self-graded: body is { grade }.
// QUIZ cards are objectively graded: body is { selectedIndex }.
const bodySchema = z.union([
  z.object({ grade: z.enum(["AGAIN", "HARD", "GOOD", "EASY"]) }),
  z.object({ selectedIndex: z.number().int().min(0) }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ cardId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { limit, windowSec } = RATE_LIMITS.reviewAnswer;
  const rl = await checkRateLimit(`ratelimit:review:${userId}`, limit, windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  const { cardId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    if ("grade" in parsed.data) {
      const card = await submitReview(userId, cardId, parsed.data.grade);
      return NextResponse.json({ card });
    }
    const result = await submitQuizAnswer(userId, cardId, parsed.data.selectedIndex);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to submit review";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
