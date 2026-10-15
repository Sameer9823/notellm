import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { serverEnv } from "@/lib/env";

/**
 * Simple token/credit budget per user, shared across every notebook they
 * own. Every metered action (chat message, source upload, audio/roadmap
 * generation) costs a fixed number of credits; once the balance hits zero
 * the user is blocked from that action until the window resets.
 *
 * Design mirrors lib/rate-limit.ts (fixed window, one file owns the whole
 * concern) but is backed by Postgres instead of Redis, because a credit
 * balance is product-visible state a user can inspect ("how many do I have
 * left, when do they refresh") rather than a disposable abuse guard — it
 * needs to survive a Redis flush/outage. `UserCredits` is looked up with a
 * row lock (`SELECT ... FOR UPDATE`) inside a transaction so two concurrent
 * requests can't both read balance=1 and both be allowed through.
 */

/** Max credits a user has available per window. */
export const CREDITS_MAX = serverEnv.credits.maxPerWindow;

/** Window length in hours before the balance refreshes back to CREDITS_MAX. */
export const CREDITS_WINDOW_HOURS = serverEnv.credits.windowHours;

export const CREDITS_WINDOW_MS = CREDITS_WINDOW_HOURS * 60 * 60 * 1000;

/** Per-action cost, tuned to the same cost/abuse-risk reasoning as RATE_LIMITS. */
export const CREDIT_COSTS = {
  chat: 1,
  sourceUpload: 3,
  audioGenerate: 15,
  roadmapGenerate: 15,
  // One structured-output LLM call — priced between chat and audio/roadmap.
  artifactGenerate: 5,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

export type CreditStatus = {
  balance: number;
  max: number;
  /** Epoch ms the balance will next refresh to `max`. */
  resetAt: number;
  windowHours: number;
};

function toStatus(balance: number, windowStart: Date): CreditStatus {
  return {
    balance,
    max: CREDITS_MAX,
    resetAt: windowStart.getTime() + CREDITS_WINDOW_MS,
    windowHours: CREDITS_WINDOW_HOURS,
  };
}

function windowExpired(windowStart: Date, now: Date): boolean {
  return now.getTime() - windowStart.getTime() >= CREDITS_WINDOW_MS;
}

/**
 * Reads the current balance, refreshing it first if the 6-hour window has
 * elapsed. Read-only — does not spend anything. Safe to call as often as
 * the UI wants to poll.
 */
export async function getCreditStatus(userId: string): Promise<CreditStatus> {
  const now = new Date();

  let existing;
  try {
    // Upsert directly instead of findUnique-then-upsert. Two near-simultaneous
    // requests (e.g. polling on page load) can both see "no row" in the old
    // check-then-act gap and both try to create it, which throws P2002 on
    // whichever loses. Narrowing to a single upsert call shrinks that window;
    // the catch below handles the residual race.
    existing = await db.userCredits.upsert({
      where: { userId },
      create: { userId, balance: CREDITS_MAX, windowStart: now },
      update: {},
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Lost the create race to a concurrent request — the row exists now.
      existing = await db.userCredits.findUniqueOrThrow({ where: { userId } });
    } else {
      throw err;
    }
  }

  if (windowExpired(existing.windowStart, now)) {
    const refreshed = await db.userCredits.update({
      where: { userId },
      data: { balance: CREDITS_MAX, windowStart: now },
    });
    return toStatus(refreshed.balance, refreshed.windowStart);
  }

  return toStatus(existing.balance, existing.windowStart);
}

/**
 * Atomically spends `amount` credits for `userId`, refreshing the window
 * first if it has expired. Returns `{ allowed: false }` (balance left
 * untouched) if the user doesn't have enough left — callers should check
 * `allowed` before doing the metered work, not after.
 */
export async function consumeCredits(
  userId: string,
  amount: number
): Promise<{ allowed: true; status: CreditStatus } | { allowed: false; status: CreditStatus }> {
  const now = new Date();

  return db.$transaction(async (tx) => {
    // Row lock so two concurrent requests from the same user can't both
    // read the same balance and both be let through past zero.
    const rows = await tx.$queryRaw<{ balance: number; windowStart: Date }[]>`
      SELECT "balance", "windowStart" FROM "UserCredits" WHERE "userId" = ${userId} FOR UPDATE
    `;

    let balance: number;
    let windowStart: Date;
    let dirty = false; // true once balance/windowStart differ from what's stored

    if (rows.length === 0) {
      // First time this user has ever spent a credit — create the row
      // (racing creates are fine, "userId" is the primary key).
      const created = await tx.userCredits.upsert({
        where: { userId },
        create: { userId, balance: CREDITS_MAX, windowStart: now },
        update: {},
      });
      balance = created.balance;
      windowStart = created.windowStart;
    } else {
      balance = rows[0].balance;
      windowStart = rows[0].windowStart;
      if (windowExpired(windowStart, now)) {
        balance = CREDITS_MAX;
        windowStart = now;
        dirty = true;
      }
    }

    if (balance < amount) {
      // Persist a refreshed-but-unspent window if one just kicked in, so a
      // reset that happened mid-check isn't lost on the next read.
      if (dirty) await tx.userCredits.update({ where: { userId }, data: { balance, windowStart } });

      // Ported from sourcelm's billing: once the free window is exhausted,
      // fall back to any purchased/subscription-granted credits before
      // blocking the action. This ledger never resets on its own (see
      // src/lib/credit-ledger.ts), unlike the window balance above.
      const last = await tx.creditTransaction.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { balanceAfter: true },
      });
      const purchased = last?.balanceAfter ?? 0;
      if (purchased >= amount) {
        await tx.creditTransaction.create({
          data: {
            userId,
            type: "USAGE",
            amount: -amount,
            balanceAfter: purchased - amount,
            description: "Metered action (purchased credits)",
          },
        });
        return { allowed: true, status: toStatus(balance, windowStart) };
      }

      return { allowed: false, status: toStatus(balance, windowStart) };
    }

    balance -= amount;
    await tx.userCredits.update({ where: { userId }, data: { balance, windowStart } });
    return { allowed: true, status: toStatus(balance, windowStart) };
  });
}

/**
 * Refunds `amount` credits to a user after a failed metered action (e.g.
 * the model threw after the credit was already consumed). Adds back to the
 * fixed-window `UserCredits.balance`, capped at `CREDITS_MAX`, inside the
 * same row-locked transaction as `consumeCredits` so a refund can't
 * double-count against a concurrent consume.
 *
 * Purchased/ledger credits (see src/lib/credit-ledger.ts) are tracked
 * separately as immutable debit/credit rows; refunding here only restores
 * free-window budget, mirroring how `consumeCredits` spends the free window
 * first. If you need purchased-credit refunds, that requires a separate
 * ledger transaction — ask before changing that behavior.
 */
export async function refundCredits(userId: string, amount: number): Promise<void> {
  const now = new Date();

  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ balance: number; windowStart: Date }[]>`
      SELECT "balance", "windowStart" FROM "UserCredits" WHERE "userId" = ${userId} FOR UPDATE
    `;

    if (rows.length === 0) return;

    let balance = rows[0].balance;
    let windowStart = rows[0].windowStart;

    if (windowExpired(windowStart, now)) {
      balance = CREDITS_MAX;
      windowStart = now;
    }

    balance = Math.min(balance + amount, CREDITS_MAX);
    await tx.userCredits.update({ where: { userId }, data: { balance, windowStart } });
  });
}

/** Builds a standard 402 response with the headers/body clients expect. */
export function creditsExhaustedResponse(status: CreditStatus) {
  const minutesLeft = Math.max(1, Math.ceil((status.resetAt - Date.now()) / 60000));
  const hoursLeft = Math.floor(minutesLeft / 60);
  const remMinutes = minutesLeft % 60;
  const human =
    hoursLeft > 0 ? `${hoursLeft}h ${remMinutes}m` : `${remMinutes}m`;

  return Response.json(
    {
      error: `You're out of credits — they refresh in ${human}.`,
      credits: status,
    },
    {
      status: 402,
      headers: {
        "X-Credits-Balance": String(status.balance),
        "X-Credits-Max": String(status.max),
        "X-Credits-Reset": String(status.resetAt),
      },
    }
  );
}