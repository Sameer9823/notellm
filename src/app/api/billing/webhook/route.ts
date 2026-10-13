import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import {
  handleCheckoutCompleted,
  handleInvoicePaid,
  upsertSubscriptionFromStripe,
} from "@/lib/billing";

// Stripe requires the raw, unparsed request body to verify the webhook
// signature, so this route reads req.text() directly — no auth/JSON
// middleware, and it's deliberately NOT in middleware.ts's protected-route
// matcher since Stripe (not a signed-in user) calls it.
export async function POST(req: Request) {
  if (!isStripeConfigured || !stripe) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, event.id);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice, event.id);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await upsertSubscriptionFromStripe(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`Error handling Stripe event ${event.type}`, err);
    // Return 200 anyway so Stripe doesn't hammer retries on a bug we've
    // already logged; alerting on the log line is the real fix path.
  }

  return NextResponse.json({ received: true });
}
