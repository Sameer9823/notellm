import { inngest, type SourceCreatedEvent, type ArtifactGenerateEvent, type AudioGenerateEvent, type RoadmapGenerateEvent } from "./client";
import { runIngestPipeline } from "@/lib/ingest";
import { runArtifactPipeline } from "@/lib/artifact-pipeline";
import { runAudioPipeline } from "@/lib/audio-pipeline";
import { runRoadmapPipeline } from "@/lib/roadmap-pipeline";

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

export const processSource = inngest.createFunction(
  { id: "process-source", retries: 3 },
  { event: "source/created" },
  async ({ event, step }) => {
    const { sourceId } = event.data as SourceCreatedEvent["data"];
    await step.run("run-ingest-pipeline", () => runIngestPipeline(sourceId));
    return { sourceId, status: "done" };
  }
);

export const generateArtifact = inngest.createFunction(
  { id: "generate-artifact", retries: 2 },
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
    // Two-host script generation + sequential per-segment TTS synthesis can
    // run long — give this job more headroom than the others before
    // Inngest considers it timed out.
    timeouts: { finish: "15m" },
  },
  { event: "audio/generate" },
  async ({ event, step }) => {
    const { audioOverviewId } = event.data as AudioGenerateEvent["data"];
    await step.run("run-audio-pipeline", () => runAudioPipeline(audioOverviewId));
    return { audioOverviewId, status: "done" };
  }
);

export const generateRoadmap = inngest.createFunction(
  { id: "generate-roadmap", retries: 2 },
  { event: "roadmap/generate" },
  async ({ event, step }) => {
    const { roadmapId } = event.data as RoadmapGenerateEvent["data"];
    await step.run("run-roadmap-pipeline", () => runRoadmapPipeline(roadmapId));
    return { roadmapId, status: "done" };
  }
);

export const functions = [processSource, generateArtifact, generateAudioOverview, generateRoadmap];
