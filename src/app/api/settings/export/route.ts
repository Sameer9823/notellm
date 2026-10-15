import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

/** Exports all user data as a JSON file. */
export async function GET(_req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [
    notebooks,
    userCredits,
    stripeCustomer,
    subscription,
    creditTransactions,
    memories,
    reviewCards,
    reviewLogs,
  ] = await Promise.all([
    db.notebook.findMany({
      where: { ownerId: userId },
      include: {
        sources: {
          include: { chunks: true, sourceFile: true },
        },
        messages: true,
        audioOverviews: true,
        roadmaps: true,
        notes: true,
        artifacts: { include: { reviewCards: true } },
        reviewCards: true,
      },
    }),
    db.userCredits.findUnique({ where: { userId } }),
    db.stripeCustomer.findUnique({ where: { userId } }),
    db.subscription.findUnique({ where: { userId } }),
    db.creditTransaction.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.userMemory.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.reviewCard.findMany({ where: { userId }, include: { logs: true } }),
    db.reviewLog.findMany({ where: { userId }, orderBy: { reviewedAt: "asc" } }),
  ]);

  const exportData = {
    exportedAt: new Date().toISOString(),
    userId,
    notebooks,
    userCredits,
    stripeCustomer,
    subscription,
    creditTransactions,
    memories,
    reviewCards,
    reviewLogs,
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="footnote-export-${userId}-${Date.now()}.json"`,
    },
  });
}