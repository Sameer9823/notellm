import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getBillingSummary } from "@/lib/billing";
import { getCreditStatus } from "@/lib/credits";
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from "@/lib/billing-config";
import { isStripeConfigured } from "@/lib/stripe";
import { Prisma } from "@prisma/client";

// GET returns everything the billing page needs in one round trip: the
// free-tier window status, any purchased/subscription-granted balance, the
// active subscription (if any), the sellable packs/plans, and whether Stripe
// billing is actually wired up (so the UI can hide checkout when it isn't).
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [freeCredits, billing] = await Promise.all([getCreditStatus(userId), getBillingSummary(userId)]);

    return NextResponse.json({
      freeCredits,
      purchasedBalance: billing.purchasedBalance,
      subscription: billing.subscription,
      packs: isStripeConfigured ? CREDIT_PACKS : [],
      plans: isStripeConfigured ? SUBSCRIPTION_PLANS : [],
      isStripeConfigured,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P1001" || err.code === "P2021")) {
      return NextResponse.json(
        { error: "The billing service is temporarily unavailable — the database is not reachable right now or tables aren't initialized." },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }
    throw err;
  }
}
