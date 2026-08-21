import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getBillingSummary } from "@/lib/billing";
import { getCreditStatus } from "@/lib/credits";
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from "@/lib/billing-config";

// GET returns everything the billing page needs in one round trip: the
// free-tier window status, any purchased/subscription-granted balance, the
// active subscription (if any), and the sellable packs/plans.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [freeCredits, billing] = await Promise.all([getCreditStatus(userId), getBillingSummary(userId)]);

  return NextResponse.json({
    freeCredits,
    purchasedBalance: billing.purchasedBalance,
    subscription: billing.subscription,
    packs: CREDIT_PACKS,
    plans: SUBSCRIPTION_PLANS,
  });
}
