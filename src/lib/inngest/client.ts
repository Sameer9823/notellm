import { Inngest } from "inngest";

/**
 * Durable background-job runner, ported from sourcelm's Inngest setup.
 * Replaces FootNote's original fire-and-forget `after()` calls for every
 * long-running pipeline (source ingest, audio overview, learning roadmap,
 * study artifacts): jobs sent through `inngest.send()` get automatic
 * retries, step-level checkpointing, and survive a server restart mid-job —
 * none of which `after()` provides.
 *
 * In local dev, run `npx inngest-cli@latest dev` alongside `npm run dev` to
 * get the Inngest Dev Server UI (http://localhost:8288) that executes these
 * functions against your Next.js app. In production, set INNGEST_EVENT_KEY
 * and INNGEST_SIGNING_KEY (from the Inngest dashboard) and Inngest Cloud
 * calls back into /api/inngest to run each step.
 */
export const inngest = new Inngest({ id: "footnote" });

export type SourceCreatedEvent = {
  name: "source/created";
  data: { sourceId: string };
};

export type ArtifactGenerateEvent = {
  name: "artifact/generate";
  data: { artifactId: string };
};

export type AudioGenerateEvent = {
  name: "audio/generate";
  data: { audioOverviewId: string };
};

export type RoadmapGenerateEvent = {
  name: "roadmap/generate";
  data: { roadmapId: string };
};

export type InngestEvents = SourceCreatedEvent | ArtifactGenerateEvent | AudioGenerateEvent | RoadmapGenerateEvent;

/**
 * Wraps `inngest.send()` so a failed enqueue never throws out of the calling
 * route. Every route that calls this has already committed a DB row (Source,
 * AudioOverview, Roadmap, Artifact) with status QUEUED by the time it sends
 * the event — if `.send()` then throws (most commonly: no local
 * `npx inngest-cli@latest dev` running, or INNGEST_EVENT_KEY/
 * INNGEST_SIGNING_KEY unset in a deployed environment) and the route lets
 * that exception bubble up, Next.js turns it into a bare 500 HTML error
 * page. The client's `err.json()` parse then fails, falls back to a generic
 * "Failed to upload"/"Something went wrong" toast, and — worse — the row
 * that was already created is left stuck in QUEUED forever with nothing
 * telling the user why.
 *
 * Callers should check the returned boolean and, on `false`, mark their row
 * FAILED with an explanatory `errorMessage` (mirroring how a real pipeline
 * failure is surfaced) instead of letting the request itself fail — the
 * user then sees a clear "failed to queue for processing" state they can
 * retry (e.g. via the existing reindex action), rather than a dead end.
 */
export async function safeSend<T extends InngestEvents>(event: T): Promise<boolean> {
  try {
    await inngest.send(event);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[inngest] Failed to enqueue "${event.name}" event:`, err);
    return false;
  }
}
