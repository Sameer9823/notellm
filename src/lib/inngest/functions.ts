import { inngest, type SourceCreatedEvent, type ArtifactGenerateEvent, type AudioGenerateEvent, type RoadmapGenerateEvent } from "./client";
import { runIngestPipeline } from "@/lib/ingest";
import { runArtifactPipeline } from "@/lib/artifact-pipeline";
import { runAudioPipeline } from "@/lib/audio-pipeline";
import { runRoadmapPipeline } from "@/lib/roadmap-pipeline";
import { db } from "@/lib/db";
import { setProgress, setArtifactProgress, setAudioProgress, setRoadmapProgress } from "@/lib/redis";
import { describeError } from "@/lib/utils";

/**
 * Durable functions, ported from sourcelm's src/server/inngest/index.ts.
 * Each function is a thin wrapper: the actual pipeline logic still lives in
 * src/lib/*-pipeline.ts (and src/lib/ingest.ts) exactly as it did under
 * `after()`, so those files stay the single source of truth for what each
 * pipeline does. Inngest just adds a single `step.run()` checkpoint per
 * function (so a crash mid-run resumes/retries the whole pipeline call
 * rather than losing it entirely) plus configurable retries and, for audio
 * generation, a longer finish timeout to cover multi-segment TTS synthesis.
 */

/**
 * Durable functions, ported from sourcelm's src/server/inngest/index.ts.
 * Each function is a thin wrapper: the actual pipeline logic still lives in
 * src/lib/*-pipeline.ts (and src/lib/ingest.ts) exactly as it did under
 * `after()`, so those files stay the single source of truth for what each
 * pipeline does. Inngest just adds a single `step.run()` checkpoint per
 * function (so a crash mid-run resumes/retries the whole pipeline call
 * rather than losing it entirely) plus configurable retries and, for audio
 * generation, a longer finish timeout to cover multi-segment TTS synthesis.
 *
 * Each function also declares an `onFailure` handler as a last line of
 * defense: if the pipeline (or even its own catch block) throws such that the
 * row is never marked FAILED, Inngest exhausts its retries and then runs this
 * handler so the row doesn't stay QUEUED forever with no error surfaced.
 */

export const processSource = inngest.createFunction(
  {
    id: "process-source",
    retries: 3,
    // Ingesting a large PDF means extracting hundreds of pages, embedding
    // every chunk (batched OpenAI calls), upserting them into Qdrant and
    // finally swapping the chunk rows in Postgres — a transaction that
    // alone takes ~10s for a few hundred chunks. The job runs inside a
    // serverless function that the platform terminates at 300s, so the
    // finish timeout tracks that ceiling rather than outlasting it.
    timeouts: { finish: "5m" },
    onFailure: async ({ event, error }) => {
      // In Inngest v3 the onFailure event is a FailureEventPayload whose
      // `.data.event.data` holds the original trigger payload.
      const data = event.data as unknown as { event: { data: { sourceId: string } } };
      const { sourceId } = data.event.data;
      const message = describeError(error);
      // eslint-disable-next-line no-console
      console.error(`[inngest] processSource failed for ${sourceId} after retries:`, message);
      await db.source
        .update({ where: { id: sourceId }, data: { status: "FAILED", errorMessage: message } })
        .catch(() => {});
      await setProgress(sourceId, { status: "FAILED", errorMessage: message, updatedAt: Date.now() }).catch(
        () => {}
      );
    },
  },
  { event: "source/created" },
  async ({ event, step }) => {
    const { sourceId } = event.data as SourceCreatedEvent["data"];
    await step.run("run-ingest-pipeline", () => runIngestPipeline(sourceId));
    return { sourceId, status: "done" };
  }
);

export const generateArtifact = inngest.createFunction(
  {
    id: "generate-artifact",
    retries: 2,
    onFailure: async ({ event, error }) => {
      const data = event.data as unknown as { event: { data: { artifactId: string } } };
      const { artifactId } = data.event.data;
      const message = describeError(error);
      // eslint-disable-next-line no-console
      console.error(`[inngest] generateArtifact failed for ${artifactId} after retries:`, message);
      await db.artifact
        .update({ where: { id: artifactId }, data: { status: "FAILED", errorMessage: message } })
        .catch(() => {});
      await setArtifactProgress(artifactId, {
        status: "FAILED",
        errorMessage: message,
        updatedAt: Date.now(),
      }).catch(() => {});
    },
  },
  { event: "artifact/generate" },
  async ({ event, step }) => {
    const { artifactId } = event.data as ArtifactGenerateEvent["data"];
    await step.run("run-artifact-pipeline", () => runArtifactPipeline(artifactId));
    return { artifactId, status: "done" };
  }
);

export const generateAudioOverview = inngest.createFunction(
  {
    id: "generate-audio-overview",
    retries: 1,
    // The whole episode has to fit inside the 300s a Vercel Hobby serverless
    // function is allowed to run, so this finish timeout tracks that ceiling
    // rather than the old 15m. If you move to a plan that allows a longer
    // maxDuration, raise `maxDuration` in src/app/api/inngest/route.ts and
    // this value together.
    timeouts: { finish: "5m" },
    onFailure: async ({ event, error }) => {
      const data = event.data as unknown as { event: { data: { audioOverviewId: string } } };
      const { audioOverviewId } = data.event.data;
      const message = describeError(error);
      // eslint-disable-next-line no-console
      console.error(`[inngest] generateAudioOverview failed for ${audioOverviewId} after retries:`, message);
      await db.audioOverview
        .update({
          where: { id: audioOverviewId },
          data: { status: "FAILED", errorMessage: message },
        })
        .catch(() => {});
      await setAudioProgress(audioOverviewId, {
        status: "FAILED",
        errorMessage: message,
        updatedAt: Date.now(),
      }).catch(() => {});
    },
  },
  { event: "audio/generate" },
  async ({ event, step }) => {
    const { audioOverviewId } = event.data as AudioGenerateEvent["data"];
    await step.run("run-audio-pipeline", () => runAudioPipeline(audioOverviewId));
    return { audioOverviewId, status: "done" };
  }
);

export const generateRoadmap = inngest.createFunction(
  {
    id: "generate-roadmap",
    retries: 2,
    onFailure: async ({ event, error }) => {
      const data = event.data as unknown as { event: { data: { roadmapId: string } } };
      const { roadmapId } = data.event.data;
      const message = describeError(error);
      // eslint-disable-next-line no-console
      console.error(`[inngest] generateRoadmap failed for ${roadmapId} after retries:`, message);
      await db.roadmap
        .update({ where: { id: roadmapId }, data: { status: "FAILED", errorMessage: message } })
        .catch(() => {});
      await setRoadmapProgress(roadmapId, {
        status: "FAILED",
        errorMessage: message,
        updatedAt: Date.now(),
      }).catch(() => {});
    },
  },
  { event: "roadmap/generate" },
  async ({ event, step }) => {
    const { roadmapId } = event.data as RoadmapGenerateEvent["data"];
    await step.run("run-roadmap-pipeline", () => runRoadmapPipeline(roadmapId));
    return { roadmapId, status: "done" };
  }
);

export const functions = [processSource, generateArtifact, generateAudioOverview, generateRoadmap];
