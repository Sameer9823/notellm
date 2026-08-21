/**
 * Optional standalone worker process.
 *
 * The app ships with an inline indexing path (API route -> `after()` ->
 * `runIngestPipeline`) so it works out of the box on a single deployment
 * with zero extra infra to run. That's fine for a demo/assignment scale.
 *
 * For real production load, swap to this worker: have the upload route
 * enqueue a BullMQ job instead of calling `after()`, deploy this file as a
 * long-running process (or a serverless queue consumer), and it will pick
 * up jobs from Redis and run the same `runIngestPipeline`. Nothing else in
 * the ingestion code needs to change — `runIngestPipeline` is already
 * infra-agnostic.
 *
 * Run with: npm run worker
 */
import { Worker } from "bullmq";
import { runIngestPipeline } from "@/lib/ingest";

const connection = { url: process.env.REDIS_URL as string };

const worker = new Worker(
  "source-indexing",
  async (job) => {
    const { sourceId } = job.data as { sourceId: string };
    await runIngestPipeline(sourceId);
  },
  { connection, concurrency: 4 }
);

worker.on("completed", (job) => console.log(`[worker] indexed source ${job.data.sourceId}`));
worker.on("failed", (job, err) => console.error(`[worker] failed source ${job?.data?.sourceId}:`, err.message));

console.log("Indexing worker listening for jobs…");
