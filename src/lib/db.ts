import { PrismaClient } from "@prisma/client";
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
