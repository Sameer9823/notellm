import { db, withTransaction } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { CreditTransactionType } from "@prisma/client";

/**
 * Purchased-credit ledger, ported from sourcelm's lib/credits.ts. This is
 * deliberately a SEPARATE pool from the free-tier fixed-window UserCredits
 * balance (src/lib/credits.ts): that balance resets to CREDITS_MAX every
 * window and would silently wipe out anything paid for, so purchases and
 * subscription grants land here instead, as an append-only, never-expiring
 * balance that `consumeCredits` falls back to once the free window is
 * exhausted (see the wiring in src/lib/credits.ts).
 */

export async function getPurchasedBalance(userId: string): Promise<number> {
  const last = await db.creditTransaction.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfter: true },
  });
  return last?.balanceAfter ?? 0;
}

export async function grantCredits(params: {
  userId: string;
  amount: number;
  type: CreditTransactionType;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  const { userId, amount, type, description, metadata } = params;
  return withTransaction(async (tx) => {
    const last = await tx.creditTransaction.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { balanceAfter: true },
    });
    const balanceAfter = (last?.balanceAfter ?? 0) + amount;
    return tx.creditTransaction.create({
      data: {
        userId,
        type,
        amount,
        balanceAfter,
        description,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  });
}

/** Spends from the purchased-credit ledger. Returns null if the balance is
 *  insufficient (caller decides what that means — usually "block the
 *  action", already having failed the free-window check first). */
export async function spendPurchasedCredits(
  userId: string,
  amount: number,
  description: string
) {
  return withTransaction(async (tx) => {
    const last = await tx.creditTransaction.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { balanceAfter: true },
    });
    const current = last?.balanceAfter ?? 0;
    if (current < amount) return null;

    const balanceAfter = current - amount;
    await tx.creditTransaction.create({
      data: { userId, type: "USAGE", amount: -amount, balanceAfter, description },
    });
    return balanceAfter;
  });
}

export async function listTransactions(userId: string, limit = 50) {
  return db.creditTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
