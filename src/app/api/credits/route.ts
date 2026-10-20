import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getCreditStatus } from "@/lib/credits";
import { CREDITS_MAX, CREDITS_WINDOW_MS, CREDITS_WINDOW_HOURS, type CreditStatus } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Returns a full default credit status when the database is unreachable or
// tables don't exist yet — the credits badge is a read-only display, so
// failing open with a full balance keeps the UI working instead of crashing
// the dashboard on local dev before `prisma db push` has been run.
function defaultCreditStatus(): CreditStatus {
  const now = Date.now();
  return {
    balance: CREDITS_MAX,
    max: CREDITS_MAX,
    resetAt: now + CREDITS_WINDOW_MS,
    windowHours: CREDITS_WINDOW_HOURS,
  };
}

// Read-only status check — does not spend anything. Used by useCredits() to
// populate and poll the credits badge shown in the dashboard and notebook
// headers.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const status = await getCreditStatus(userId);
    return NextResponse.json({ credits: status });
  } catch {
    // Database unreachable (P1001) or tables missing (P2021) — fall back to
    // a default full-balance status so the UI stays up and polling doesn't
    // 500-loop. This is explicitly a fail-open display value: it never
    // authorizes a spend, only feeds the badge.
    return NextResponse.json({ credits: defaultCreditStatus() });
  }
}
