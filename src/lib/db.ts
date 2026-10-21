import { Prisma, PrismaClient } from "@prisma/client";
import { serverEnv } from "@/lib/env";

// Prevent hot-reload from spawning new pools against Neon in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function withConnectTimeout(url: string | undefined): string | undefined {
  if (!url) return url;
  if (url.includes("connect_timeout")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}connect_timeout=10`;
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: serverEnv.isProduction ? ["error"] : ["warn", "error"],
    datasources: {
      db: {
        url: withConnectTimeout(serverEnv.database.url),
       },
     },
   });

if (!serverEnv.isProduction) globalForPrisma.prisma = db;

/**
 * True for failures that are worth retrying: the pooled Postgres connection
 * was dropped, the server was restarting, or the request timed out. These
 * are transient — the same query usually succeeds a second later.
 */
export function isTransientDbError(err: unknown): boolean {
  const e = (err ?? {}) as { code?: string; message?: string; errorCode?: string };
  const code = e.code ?? e.errorCode ?? "";
  if (["P1001", "P1002", "P1008", "P1010", "P2024", "P2028", "P2034"].includes(code)) return true;
  const msg = (e.message ?? "").toLowerCase();
  return /can't reach database server|connection reset|connection closed|connection refused|server closed the connection|terminating connection|connection not open|econnreset|econnrefused|etimedout|epipe|timeout/i.test(msg);
}

/**
 * Runs a database operation and retries it while the failure looks transient.
 *
 * Pooled Postgres (Neon's pooler in particular) periodically drops idle
 * connections, and a blip in the middle of a long job is expensive: the
 * audio pipeline can spend many minutes synthesizing speech and then throw
 * the result away because the final `update` happened to land during a
 * reconnect. Retrying the write is cheap next to re-running the job.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  { attempts = 5, baseDelayMs = 400 }: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || i === attempts - 1) throw err;
      const delay = baseDelayMs * 2 ** i + Math.random() * 250;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Defaults for interactive transactions.
 *
 * Prisma's own defaults (maxWait 2s, timeout 5s) assume a Postgres on the
 * same machine. This app talks to Neon through its connection pooler, where
 * every round trip costs far more than a local socket, so the 5s cap is
 * routinely exceeded even by small transactions.
 */
export const TRANSACTION_DEFAULTS = {
  /** How long to wait for a connection to become available. */
  maxWait: 15_000,
  /** How long the transaction may run once it has started. */
  timeout: 30_000,
} as const;

/**
 * Runs an interactive transaction with timeouts that work against a pooled
 * remote Postgres.
 *
 * Use this instead of `db.$transaction(...)` so every transaction gets the
 * same headroom. The timeout matters most for:
 *
 *  - the chunk swap in the ingest pipeline, which deletes and re-inserts
 *    every chunk of a source (a PDF runs to several hundred rows) in one
 *    atomic statement pair, and
 *  - the credit ledger, which takes a `SELECT ... FOR UPDATE` row lock and
 *    therefore has to wait for any concurrent request touching the same
 *    user's balance.
 */
export function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { maxWait?: number; timeout?: number } = {}
): Promise<T> {
  return db.$transaction(fn, { ...TRANSACTION_DEFAULTS, ...options });
}
