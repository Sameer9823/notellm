/**
 * One-time script: re-indexes every PDF source that has a stored file
 * (either a Cloudinary `storagePath` or a local `SourceFile` row). Re-running
 * ingestion with the fixed geometry-based text extractor repairs chunks that
 * were garbled by the old `items.map(item => item.str).join(" ")` approach.
 *
 * PDFs with no stored file can't be repaired — they must be re-uploaded.
 * This script prints a list of those at the end.
 *
 * Usage:
 *   npx tsx scripts/reindex-pdfs.ts
 */
import { PrismaClient } from "@prisma/client";
import { runIngestPipeline } from "../src/lib/ingest";

const db = new PrismaClient();

async function main() {
  const pdfs = await db.source.findMany({
    where: { type: "PDF" },
    select: {
      id: true,
      title: true,
      storagePath: true,
      sourceFile: { select: { id: true } },
      status: true,
    },
  });

  const reindexable = pdfs.filter((s) => !!s.storagePath || !!s.sourceFile);
  const unfixable = pdfs.filter((s) => !s.storagePath && !s.sourceFile);

  console.log(`Found ${pdfs.length} PDF sources total.`);
  console.log(`  Re-indexable (have a stored file): ${reindexable.length}`);
  console.log(`  Cannot repair (no stored file): ${unfixable.length}`);

  if (unfixable.length > 0) {
    console.log("\n--- PDFs that need re-upload ---");
    for (const s of unfixable) {
      console.log(`  ${s.title} (${s.id})`);
    }
  }

  if (reindexable.length === 0) return;

  console.log(`\nRe-indexing ${reindexable.length} PDFs...`);
  let done = 0;
  let failed = 0;

  for (const s of reindexable) {
    process.stdout.write(`  ${s.title} (${s.id}) ... `);
    try {
      await runIngestPipeline(s.id);
      const updated = await db.source.findUnique({ where: { id: s.id }, select: { status: true, errorMessage: true } });
      if (updated?.status === "READY") {
        console.log("OK");
        done++;
      } else {
        console.log(`FAILED (${updated?.errorMessage ?? updated?.status})`);
        failed++;
      }
    } catch (err) {
      console.log(`FAILED (${err instanceof Error ? err.message : String(err)})`);
      failed++;
    }
  }

  console.log(`\nDone — ${done} re-indexed, ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
