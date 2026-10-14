import { PrismaClient } from "@prisma/client";

// Prevent hot-reload from spawning new pools against Neon in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Append connect_timeout to the database URL so Prisma fails fast (10s)
// on an unreachable server instead of hanging for the libpq default of
// 300s. This keeps the credits / auth routes responsive during Neon
// pooler blips — see the P1001 errors in the dev server logs.
function withConnectTimeout(url: string | undefined): string | undefined {
  if (!url) return url;
  if (url.includes("connect_timeout")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}connect_timeout=10`;
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    datasources: {
      db: {
        url: withConnectTimeout(process.env.DATABASE_URL),
      },
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
