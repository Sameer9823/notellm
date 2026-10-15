import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

const bodySchema = z.object({
  confirm: z.literal("DELETE ALL MY DATA"),
});

import { z } from "zod";

/** Deletes ALL user data irreversibly. Requires a confirmation string. */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid confirmation. Send { \"confirm\": \"DELETE ALL MY DATA\" }" },
      { status: 400 }
    );
  }

  await deleteUserData(userId);

  return NextResponse.json({ success: true, message: "All data deleted" });
}

async function deleteUserData(userId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.reviewLog.deleteMany({ where: { userId } });
    await tx.reviewCard.deleteMany({ where: { userId } });
    await tx.userMemory.deleteMany({ where: { userId } });
    await tx.creditTransaction.deleteMany({ where: { userId } });
    await tx.subscription.deleteMany({ where: { userId } });
    await tx.stripeCustomer.deleteMany({ where: { userId } });
    await tx.userCredits.deleteMany({ where: { userId } });
    await tx.notebook.deleteMany({ where: { ownerId: userId } });
  });
}