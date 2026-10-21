import { Inngest } from "inngest";
import { serverEnv, clientEnv } from "@/lib/env";

/** App id shared by the Inngest client and the dev-server registration check
 *  below. The dev server exposes every registered function with a slug of
 *  "<app id>-<function id>", which is how we tell "the dev server is up" from
 *  "the dev server has actually connected to this app". */
const APP_ID = "footnote";

/** How long to wait for the dev server to register this app before giving up
 *  on an enqueue.
 *
 *  This wait happens inside the request that triggers the job, so it has to
 *  fit inside the shortest `maxDuration` among the routes that enqueue
 *  (15s for /api/sources/[id]/reindex). The dev server polls the app every
 *  few seconds, so a short window covers the normal race; when it is not
 *  enough the caller gets an explicit "not registered yet" error and can
 *  retry, instead of a job that silently never runs. */
const APP_REGISTRATION_TIMEOUT_MS = 8_000;

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
export const inngest = new Inngest({ id: APP_ID });

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
  serverEnv.inngest.devserverUrl ||
  "http://localhost:8288";

// Briefly remembers the dev server was unreachable so a burst of enqueues
// (or a stuck poll) doesn't each pay the full probe timeout. We never cache
// the "reachable" side: always re-probe before sending so a dev server that
// crashes mid-session can't let an event silently fall through to Inngest
// Cloud (which can't dispatch back to a localhost app = stuck in QUEUED).
let devServerKnownDownUntil = 0;

type DevServerState = {
  /** The dev server answered at all. */
  reachable: boolean;
  /** The dev server has this app's functions registered and can execute them. */
  appRegistered: boolean;
};

/**
 * Probes the local Inngest dev server for its registration state.
 *
 * "Reachable" is not enough: the dev server accepts events on /e/<key> even
 * when no app is registered against it, and those events are then accepted
 * and silently never executed — the job sits in QUEUED until the client
 * gives up and reports "the background worker didn't pick it up". The dev
 * server needs a moment after startup to discover the Next.js app (which
 * itself has to compile /api/inngest first), so we also report whether this
 * app's functions are registered yet.
 */
async function probeDevServer(): Promise<DevServerState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${devServerOrigin}/dev`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      devServerKnownDownUntil = Date.now() + 5000;
      return { reachable: false, appRegistered: false };
    }
    const body = (await res.json().catch(() => null)) as { functions?: { slug?: string }[] } | null;
    const functions = Array.isArray(body?.functions) ? body.functions : [];
    return {
      reachable: true,
      appRegistered: functions.some((f) => typeof f?.slug === "string" && f.slug.startsWith(`${APP_ID}-`)),
    };
  } catch {
    clearTimeout(timeout);
    devServerKnownDownUntil = Date.now() + 5000;
    return { reachable: false, appRegistered: false };
  }
}

/**
 * Waits for the dev server to finish registering this app. Returns the final
 * state. The dev server polls the app every few seconds, so the window only
 * has to cover the normal registration race; when it expires the caller is
 * told the app is not registered yet instead of queueing a job that would
 * never run.
 */
async function waitForAppRegistration(timeoutMs: number): Promise<DevServerState> {
  const deadline = Date.now() + timeoutMs;
  let state = await probeDevServer();
  while (state.reachable && !state.appRegistered && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    state = await probeDevServer();
  }
  return state;
}

export async function safeSend<T extends InngestEvents>(event: T): Promise<boolean> {
   if (!serverEnv.isProduction) {
    const now = Date.now();
    if (now >= devServerKnownDownUntil) {
      const state = await probeDevServer();
      if (!state.reachable) {
        // eslint-disable-next-line no-console
        console.error(
          `[inngest] local dev server at ${devServerOrigin} is not reachable; ` +
            `not enqueuing "${event.name}". The \`dev\` script starts it automatically ` +
            `via \`npx inngest-cli@latest dev\`; if you're running \`next dev\` directly, ` +
            `start the dev server in a second terminal.`
        );
        return false;
      }
      if (!state.appRegistered) {
        // The dev server is up but has not connected to this app yet, so it
        // would accept the event and never run it. Wait for the registration
        // instead of queueing a job that is guaranteed to time out.
        const waited = await waitForAppRegistration(APP_REGISTRATION_TIMEOUT_MS);
        if (!waited.appRegistered) {
          // eslint-disable-next-line no-console
          console.error(
            `[inngest] dev server at ${devServerOrigin} is running but has not registered ` +
              `the "${APP_ID}" app yet; not enqueuing "${event.name}". This normally takes ` +
              `under a minute after \`npm run dev\` starts - try again in a moment.`
          );
          return false;
        }
      }
    } else {
      // eslint-disable-next-line no-console
      console.error(
        `[inngest] local dev server at ${devServerOrigin} was recently unreachable; ` +
          `not enqueuing "${event.name}".`
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
