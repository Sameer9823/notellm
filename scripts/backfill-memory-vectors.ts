/**
 * One-time backfill: embeds every UserMemory row that predates the
 * Qdrant-backed semantic memory upgrade (vectorId is null) and upserts
 * it into the `user_memories` collection, so getMemoryContext's semantic
 * search covers old memories too instead of silently falling back to
 * recency for them forever.
 *
 * Safe to re-run — only touches rows where vectorId is still null.
 *
 * Usage:
 *   npx tsx scripts/backfill-memory-vectors.ts
 */
import { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { openai } from "../src/lib/openai";
import { upsertMemoryVector } from "../src/lib/qdrant";

const db = new PrismaClient();
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

async function main() {
  const pending = await db.userMemory.findMany({
    where: { vectorId: null },
    select: { id: true, userId: true, memory: true, source: true },
  });

  if (pending.length === 0) {
    console.log("Nothing to backfill — every memory already has a vector.");
    return;
  }

  console.log(`Backfilling ${pending.length} memories...`);
  let done = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: row.memory });
      const vectorId = uuid();
      await upsertMemoryVector(vectorId, res.data[0].embedding, {
        userId: row.userId,
        memory: row.memory,
        source: row.source as "MANUAL" | "LEARNED",
      });
      await db.userMemory.update({ where: { id: row.id }, data: { vectorId } });
      done++;
    } catch (err) {
      failed++;
      console.warn(`  Failed on memory ${row.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Done — ${done} embedded, ${failed} failed (left for a re-run).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
