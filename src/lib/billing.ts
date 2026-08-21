import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { CREDIT_PACKS, SUBSCRIPTION_PLANS, findPlanByPriceId } from "@/lib/billing-config";
import { grantCredits, getPurchasedBalance } from "@/lib/credit-ledger";
import type Stripe from "stripe";

export async function getOrCreateStripeCustomerId(userId: string, email: string, name: string): Promise<string> {
  const existing = await db.stripeCustomer.findUnique({ where: { userId } });
  if (existing) return existing.stripeCustomerId;

  const customer = await stripe.customers.create({ email, name, metadata: { userId } });
  await db.stripeCustomer.create({ data: { userId, stripeCustomerId: customer.id } });
  return customer.id;
}

export async function createCheckoutSession(params: {
  userId: string;
  email: string;
  name: string;
  kind: "pack" | "subscription";
  id: string;
  appUrl: string;
}) {
  const { userId, email, name, kind, id, appUrl } = params;

  const item = kind === "pack" ? CREDIT_PACKS.find((p) => p.id === id) : SUBSCRIPTION_PLANS.find((p) => p.id === id);
  if (!item) throw new Error("Unknown plan or pack");
  if (!item.stripePriceId) {
    throw new Error(`Stripe price id not configured for ${id}. Set the matching env var.`);
  }

  const customerId = await getOrCreateStripeCustomerId(userId, email, name);

  const session = await stripe.checkout.sessions.create(
    {
      customer: customerId,
      mode: kind === "pack" ? "payment" : "subscription",
      line_items: [{ price: item.stripePriceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard/billing?checkout=success`,
      cancel_url: `${appUrl}/dashboard/billing?checkout=cancelled`,
      metadata: { userId, kind, planId: id },
      payment_intent_data: kind === "pack" ? { metadata: { userId, planId: id } } : undefined,
      subscription_data: kind === "subscription" ? { metadata: { userId, planId: id } } : undefined,
    },
    { idempotencyKey: `footnote-${kind}-${userId}-${id}-${Date.now()}` }
  );

  return session;
}

export async function createBillingPortalSession(userId: string, appUrl: string) {
  const customer = await db.stripeCustomer.findUnique({ where: { userId } });
  if (!customer) throw new Error("No billing account yet");

  const portal = await stripe.billingPortal.sessions.create({
    customer: customer.stripeCustomerId,
    return_url: `${appUrl}/dashboard/billing`,
  });

  return portal;
}

/** Idempotently marks a webhook event as processed. Returns false if it was already handled. */
async function claimEvent(eventId: string): Promise<boolean> {
  try {
    await db.processedStripeEvent.create({ data: { id: eventId } });
    return true;
  } catch {
    return false; // unique constraint hit -> already processed
  }
}

export async function handleCheckoutCompleted(session: Stripe.Checkout.Session, eventId: string) {
  if (!(await claimEvent(eventId))) return;

  const userId = session.metadata?.userId;
  const kind = session.metadata?.kind;
  const planId = session.metadata?.planId;
  if (!userId || kind !== "pack" || !planId) return;

  const pack = CREDIT_PACKS.find((p) => p.id === planId);
  if (!pack) return;

  await grantCredits({
    userId,
    amount: pack.credits,
    type: "PURCHASE",
    description: `Purchased ${pack.name}`,
    metadata: { stripeSessionId: session.id, packId: pack.id },
  });
}

export async function handleInvoicePaid(invoice: Stripe.Invoice, eventId: string) {
  if (!(await claimEvent(eventId))) return;

  let subscriptionId: string | undefined;
  const subscription = (invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription }).subscription;
  if (typeof subscription === "string") {
    subscriptionId = subscription;
  } else if (subscription && typeof subscription === "object" && "id" in subscription) {
    subscriptionId = subscription.id;
  } else if (
    "parent" in invoice &&
    invoice.parent &&
    typeof invoice.parent === "object" &&
    "subscription_details" in invoice.parent &&
    invoice.parent.subscription_details &&
    typeof invoice.parent.subscription_details.subscription === "string"
  ) {
    subscriptionId = invoice.parent.subscription_details.subscription;
  }

  if (!subscriptionId) return;

  const sub = await db.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
  if (!sub) return; // will be created by subscription.created handler first

  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === sub.planId);
  if (!plan) return;

  await grantCredits({
    userId: sub.userId,
    amount: plan.monthlyCredits,
    type: "SUBSCRIPTION_GRANT",
    description: `${plan.name} monthly renewal`,
    metadata: { invoiceId: invoice.id },
  });
}

export async function upsertSubscriptionFromStripe(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;
  const planId = subscription.metadata?.planId;
  const priceId = subscription.items.data[0]?.price.id;
  if (!userId) return;

  const resolvedPlanId = planId ?? findPlanByPriceId(priceId ?? "")?.id ?? "unknown";
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end;

  await db.subscription.upsert({
    where: { stripeSubscriptionId: subscription.id },
    create: {
      userId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId ?? "",
      planId: resolvedPlanId,
      status: mapStripeStatus(subscription.status),
      currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : new Date(),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
    update: {
      status: mapStripeStatus(subscription.status),
      currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });
}

function mapStripeStatus(
  status: Stripe.Subscription.Status
): "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" | "UNPAID" {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "unpaid":
      return "UNPAID";
    default:
      return "INCOMPLETE";
  }
}

export async function getBillingSummary(userId: string) {
  const [purchasedBalance, subscription] = await Promise.all([
    getPurchasedBalance(userId),
    db.subscription.findUnique({ where: { userId } }),
  ]);

  return { purchasedBalance, subscription };
}
