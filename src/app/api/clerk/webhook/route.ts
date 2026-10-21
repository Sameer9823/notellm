import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { withTransaction } from "@/lib/db";
import { serverEnv } from "@/lib/env";

const webhookSecret = serverEnv.clerk.webhookSecret;

export async function POST(req: Request) {
  if (!webhookSecret) {
    console.warn("CLERK_WEBHOOK_SECRET not set — Clerk webhook disabled");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const rawBody = await req.text();

  try {
    const wh = new Webhook(webhookSecret);
    const verified = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as unknown as { type: string; data: Record<string, unknown> };
    const event = verified;

    // Handle user deletion — cascade deletes all user-owned data
    if (event.type === "user.deleted") {
      const userId = event.data.id as string;
      if (!userId) {
        return NextResponse.json({ error: "Missing user id" }, { status: 400 });
      }

      try {
        await deleteUserData(userId);
        console.log(`Clerk webhook: deleted all data for user ${userId}`);
      } catch (err) {
        console.error(`Failed to delete data for user ${userId}`, err);
        return NextResponse.json({ error: "Deletion failed" }, { status: 500 });
      }
    }

    // Handle user updated (e.g., email changes) — optional, but good to sync
    if (event.type === "user.updated") {
      // Could sync email/profile data here if stored locally
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Clerk webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
}

async function deleteUserData(userId: string): Promise<void> {
  // Delete in dependency order (children first due to foreign keys)
  // Note: Prisma cascade deletes handle most of this, but explicit deletion
  // ensures we don't hit FK issues with tables that don't have cascade.
  await withTransaction(async (tx) => {
    // Review logs (append-only, safe to delete)
    await tx.reviewLog.deleteMany({ where: { userId } });

    // Review cards (cascade from notebook/artifact, but userId is denormalized)
    await tx.reviewCard.deleteMany({ where: { userId } });

    // Memories
    await tx.userMemory.deleteMany({ where: { userId } });

    // Credit transactions
    await tx.creditTransaction.deleteMany({ where: { userId } });

    // Processed stripe events - not user-scoped, skip

    // Subscription
    await tx.subscription.deleteMany({ where: { userId } });

    // Stripe customer
    await tx.stripeCustomer.deleteMany({ where: { userId } });

    // User credits
    await tx.userCredits.deleteMany({ where: { userId } });

    // Notebooks (cascade deletes: sources, messages, audio, roadmaps, notes, artifacts, reviewCards)
    await tx.notebook.deleteMany({ where: { ownerId: userId } });

    // Any remaining sources owned indirectly (should be covered by notebook cascade)
    // Chunks are cascaded from sources
  });
}