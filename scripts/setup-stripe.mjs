/**
 * One-time setup script: creates the 3 credit packs + 2 subscription plans
 * defined in src/lib/billing-config.ts as real Stripe Products/Prices in
 * your Stripe account, then prints the STRIPE_PRICE_* env vars to paste
 * into .env.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe.mjs
 *
 * Safe to re-run: it looks up existing products by name before creating,
 * so re-running won't create duplicates — it'll just print the existing
 * price ids again.
 *
 * Uses your TEST key by default if you pass a sk_test_ key (recommended
 * first) — swap to your sk_live_ key only once you've verified checkout
 * end-to-end in test mode.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY before running this script, e.g.:\n  STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe.mjs");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });

// Keep this in sync with src/lib/billing-config.ts by hand — it's a small,
// rarely-changed list, so duplicating it here avoids this script needing
// to import a TypeScript file directly.
const CREDIT_PACKS = [
  { id: "pack_starter", name: "Starter Pack", credits: 200, priceUsd: 5 },
  { id: "pack_pro", name: "Pro Pack", credits: 550, priceUsd: 12 },
  { id: "pack_power", name: "Power Pack", credits: 1500, priceUsd: 29 },
];

const SUBSCRIPTION_PLANS = [
  { id: "plan_plus", name: "Plus", monthlyCredits: 1000, priceUsd: 15 },
  { id: "plan_pro", name: "Pro", monthlyCredits: 3500, priceUsd: 39 },
];

async function findExistingPrice(productName) {
  const products = await stripe.products.search({ query: `name:'${productName}' AND active:'true'` });
  const product = products.data[0];
  if (!product) return null;
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 1 });
  return prices.data[0] ?? null;
}

async function ensurePack(pack) {
  const existing = await findExistingPrice(pack.name);
  if (existing) {
    console.log(`  Found existing price for "${pack.name}": ${existing.id}`);
    return existing.id;
  }
  const product = await stripe.products.create({
    name: pack.name,
    description: `${pack.credits.toLocaleString()} FootNote credits (one-time)`,
    metadata: { footnotePackId: pack.id },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: pack.priceUsd * 100,
    currency: "usd",
  });
  console.log(`  Created "${pack.name}": ${price.id}`);
  return price.id;
}

async function ensurePlan(plan) {
  const existing = await findExistingPrice(plan.name + " (FootNote plan)");
  if (existing) {
    console.log(`  Found existing price for "${plan.name}": ${existing.id}`);
    return existing.id;
  }
  const product = await stripe.products.create({
    name: `${plan.name} (FootNote plan)`,
    description: `${plan.monthlyCredits.toLocaleString()} FootNote credits per month`,
    metadata: { footnotePlanId: plan.id },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: plan.priceUsd * 100,
    currency: "usd",
    recurring: { interval: "month" },
  });
  console.log(`  Created "${plan.name}": ${price.id}`);
  return price.id;
}

async function main() {
  console.log(`Using ${key.startsWith("sk_live_") ? "LIVE" : "TEST"} mode key.\n`);

  console.log("Credit packs (one-time):");
  const packIds = {};
  for (const pack of CREDIT_PACKS) {
    packIds[pack.id] = await ensurePack(pack);
  }

  console.log("\nSubscription plans (monthly):");
  const planIds = {};
  for (const plan of SUBSCRIPTION_PLANS) {
    planIds[plan.id] = await ensurePlan(plan);
  }

  console.log("\n--- Paste these into your .env ---\n");
  console.log(`STRIPE_PRICE_PACK_STARTER="${packIds.pack_starter}"`);
  console.log(`STRIPE_PRICE_PACK_PRO="${packIds.pack_pro}"`);
  console.log(`STRIPE_PRICE_PACK_POWER="${packIds.pack_power}"`);
  console.log(`STRIPE_PRICE_PLAN_PLUS="${planIds.plan_plus}"`);
  console.log(`STRIPE_PRICE_PLAN_PRO="${planIds.plan_pro}"`);
  console.log("\nDon't forget STRIPE_SECRET_KEY (the key you just used) and STRIPE_WEBHOOK_SECRET (see step 3 below) too.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
