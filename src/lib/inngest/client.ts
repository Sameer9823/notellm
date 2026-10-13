import { Inngest } from "inngest";

/**
 * Durable background-job runner, ported from sourcelm's Inngest setup.
 * Replaces FootNote's original fire-and-forget `after()` calls for every
 * long-running pipeline (source ingest, audio overview, learning roadmap,
 * study artifacts): jobs sent through `inngest.send()` get automatic
 * retries, step-level checkpointing, and survive a server restart mid-job —
 * none of which `after()` provides.
 *
 * In local dev, the `dev` script starts the Inngest dev server automatically
 * (`npm run dev` runs both Next.js and `npx inngest-cli@latest dev`), which
 * executes these functions against your Next.js app via http://localhost:8288.
 * If you run `next dev` directly instead, also start the dev server in a
 * second terminal. In production, set INNGEST_EVENT_KEY and
 * INNGEST_SIGNING_KEY (from the Inngest dashboard) and Inngest Cloud calls
 * back into /api/inngest to run each step.
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

const devServerOrigin =
  process.env.INNGEST_DEVSERVER_URL ||
  process.env.NEXT_PUBLIC_INNGEST_DEVSERVER_URL ||
  process.env.REACT_APP_INNGEST_DEVSERVER_URL ||
  "http://localhost:8288";

// Briefly remembers the dev server was unreachable so a burst of enqueues
// (or a stuck poll) doesn't each pay the full probe timeout. We never cache
// the "reachable" side: always re-probe before sending so a dev server that
// crashes mid-session can't let an event silently fall through to Inngest
// Cloud (which can't dispatch back to a localhost app = stuck in QUEUED).
let devServerKnownDownUntil = 0;

async function devServerReachable(): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return true;
  const now = Date.now();
  if (now < devServerKnownDownUntil) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${devServerOrigin}/dev`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      devServerKnownDownUntil = now + 5000;
      return false;
    }
    return true;
  } catch {
    clearTimeout(timeout);
    devServerKnownDownUntil = now + 5000;
    return false;
  }
}

export async function safeSend<T extends InngestEvents>(event: T): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") {
    const reachable = await devServerReachable();
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.error(
        `[inngest] local dev server at ${devServerOrigin} is not reachable; ` +
          `not enqueuing "${event.name}". The \`dev\` script starts it automatically ` +
          `via \`npx inngest-cli@latest dev\`; if you're running \`next dev\` directly, ` +
          `start the dev server in a second terminal.`
      );
      return false;
    }
  }

  try {
    await inngest.send(event);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[inngest] Failed to enqueue "${event.name}" event:`, err);
    return false;
  }
}
