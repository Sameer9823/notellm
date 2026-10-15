import Stripe from "stripe";
import { serverEnv } from "@/lib/env";

const stripeConfig = serverEnv.stripe;

export const isStripeConfigured = stripeConfig.enabled;

export const stripe: Stripe | null = stripeConfig.enabled && stripeConfig.secretKey
  ? new Stripe(stripeConfig.secretKey, {
      apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
    })
  : null;

if (!isStripeConfigured) {
  // eslint-disable-next-line no-console
  console.warn("STRIPE_SECRET_KEY is not set — billing routes will be disabled.");
}
