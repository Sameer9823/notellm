import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createBillingPortalSession } from "@/lib/billing";
import { clientEnv } from "@/lib/env";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appUrl = clientEnv.appUrl;

  try {
    const portal = await createBillingPortalSession(userId, appUrl);
    return NextResponse.json({ url: portal.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to open billing portal";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
