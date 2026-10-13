import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY?.trim();

// Stripe is optional — the app builds, boots, and runs fine without it.
// Billing/checkout features simply degrade gracefully when the key isn't set.
export const isStripeConfigured = !!STRIPE_SECRET_KEY;

export const stripe: Stripe | null = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      // Cast avoids pinning to whatever literal date the installed `stripe`
      // package's types happen to expect — Stripe accounts default to their
      // configured API version regardless, so this stays forward-compatible
      // as the SDK is upgraded.
      apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
    })
  : null;

if (!isStripeConfigured) {
  console.warn("STRIPE_SECRET_KEY is not set — billing routes will be disabled.");
}
