import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getCreditStatus } from "@/lib/credits";

// Read-only status check — does not spend anything. Used by useCredits() to
// populate and poll the credits badge shown in the dashboard and notebook
// headers.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = await getCreditStatus(userId);
  return NextResponse.json({ credits: status });
}
