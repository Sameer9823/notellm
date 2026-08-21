import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getReviewQueue } from "@/lib/review";

// GET builds today's spaced-repetition review session: overdue cards
// first, then never-reviewed cards to fill out the session.
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : undefined;

  const queue = await getReviewQueue(userId, limit);
  return NextResponse.json({ queue });
}
