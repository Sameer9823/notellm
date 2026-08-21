/**
 * Single source of truth for FootNote's paid credit economics, ported from
 * sourcelm's credits-config.ts. This sits alongside the existing free-tier
 * fixed-window UserCredits system (src/lib/credits.ts): purchases/subscription
 * grants here top up the *same* UserCredits.balance via lib/billing.ts, so
 * CREDIT_COSTS in lib/credits.ts remains the one place action pricing lives.
 */

function readStripePriceId(name: string): string {
  // Unlike sourcelm, we don't throw at import time if a price id is
  // missing — that would break `next build`/local dev for anyone who
  // hasn't configured Stripe yet. Checkout for an unconfigured item fails
  // loudly and specifically instead (see src/lib/billing.ts).
  return process.env[name]?.trim() ?? "";
}

/** One-time top-up packs, sold via Stripe Checkout (mode: "payment"). */
export const CREDIT_PACKS = [
  {
    id: "pack_starter",
    name: "Starter Pack",
    credits: 200,
    priceUsd: 5,
    stripePriceId: readStripePriceId("STRIPE_PRICE_PACK_STARTER"),
  },
  {
    id: "pack_pro",
    name: "Pro Pack",
    credits: 550,
    priceUsd: 12,
    stripePriceId: readStripePriceId("STRIPE_PRICE_PACK_PRO"),
    badge: "Best value",
  },
  {
    id: "pack_power",
    name: "Power Pack",
    credits: 1500,
    priceUsd: 29,
    stripePriceId: readStripePriceId("STRIPE_PRICE_PACK_POWER"),
  },
] as const;

/** Recurring monthly plans, sold via Stripe Checkout (mode: "subscription"). */
export const SUBSCRIPTION_PLANS = [
  {
    id: "plan_plus",
    name: "Plus",
    monthlyCredits: 1000,
    priceUsd: 15,
    stripePriceId: readStripePriceId("STRIPE_PRICE_PLAN_PLUS"),
    blurb: "For regular research & study sessions",
  },
  {
    id: "plan_pro",
    name: "Pro",
    monthlyCredits: 3500,
    priceUsd: 39,
    stripePriceId: readStripePriceId("STRIPE_PRICE_PLAN_PRO"),
    blurb: "For heavy daily use across many notebooks",
    badge: "Most popular",
  },
] as const;

export type CreditPack = (typeof CREDIT_PACKS)[number];
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export function findPackById(id: string) {
  return CREDIT_PACKS.find((p) => p.id === id);
}

export function findPlanById(id: string) {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id);
}

export function findPlanByPriceId(stripePriceId: string) {
  return SUBSCRIPTION_PLANS.find((p) => p.stripePriceId === stripePriceId);
}
