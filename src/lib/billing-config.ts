import { serverEnv } from "@/lib/env";

/**
 * Single source of truth for FootNote's paid credit economics, ported from
 * sourcelm's credits-config.ts. This sits alongside the existing free-tier
 * fixed-window UserCredits system (src/lib/credits.ts): purchases/subscriptions
 * grants here top up the *same* UserCredits.balance via lib/billing.ts, so
 * CREDIT_COSTS in lib/credits.ts remains the one place action pricing lives.
 */

const prices = serverEnv.stripe.prices;

/** One-time top-up packs, sold via Stripe Checkout (mode: "payment"). */
export const CREDIT_PACKS = [
  {
    id: "pack_starter",
    name: "Starter Pack",
    credits: 200,
    priceUsd: 5,
    stripePriceId: prices.packStarter ?? "",
  },
  {
    id: "pack_pro",
    name: "Pro Pack",
    credits: 550,
    priceUsd: 12,
    stripePriceId: prices.packPro ?? "",
    badge: "Best value",
  },
  {
    id: "pack_power",
    name: "Power Pack",
    credits: 1500,
    priceUsd: 29,
    stripePriceId: prices.packPower ?? "",
  },
] as const;

/** Recurring monthly plans, sold via Stripe Checkout (mode: "subscription"). */
export const SUBSCRIPTION_PLANS = [
  {
    id: "plan_plus",
    name: "Plus",
    monthlyCredits: 1000,
    priceUsd: 15,
    stripePriceId: prices.planPlus ?? "",
    blurb: "For regular research & study sessions",
  },
  {
    id: "plan_pro",
    name: "Pro",
    monthlyCredits: 3500,
    priceUsd: 39,
    stripePriceId: prices.planPro ?? "",
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
