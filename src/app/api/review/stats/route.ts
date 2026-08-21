import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getReviewStats } from "@/lib/review";

// GET returns due-card count, total cards, cards reviewed today, and the
// current daily streak — the numbers that make review a habit.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const stats = await getReviewStats(userId);
  return NextResponse.json({ stats });
}
