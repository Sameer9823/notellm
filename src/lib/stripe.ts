import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  // Don't throw at import time in dev/build without keys configured yet;
  // any actual Stripe call will fail loudly and obviously instead.
  console.warn("STRIPE_SECRET_KEY is not set — billing routes will fail.");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  // Cast avoids pinning to whatever literal date the installed `stripe`
  // package's types happen to expect — Stripe accounts default to their
  // configured API version regardless, so this stays forward-compatible
  // as the SDK is upgraded.
  apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
});
