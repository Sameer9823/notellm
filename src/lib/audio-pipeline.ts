import { db, withDbRetry } from "@/lib/db";
import { setAudioProgress } from "@/lib/redis";
import { generateAudioScript, synthesizeAudioScript } from "@/lib/openai";
import { describeError } from "@/lib/utils";
import { cloudinaryEnabled, uploadBuffer } from "@/lib/cloudinary";

const MAX_CONTEXT_CHARS = 14000; // keep the script-generation prompt bounded

/**
 * Wall-clock budget for the synthesis phase.
 *
 * The job runs inside a serverless function that the platform terminates at
 * 300s (the Vercel Hobby ceiling). Script generation and the final store
 * need a slice of that too, so synthesis gets 180s. With the default
 * `tts-1` model a full episode renders in ~15s, so this budget is only ever
 * reached when the TTS model is unusually slow.
 */
const TTS_DEADLINE_MS = 180_000;

function escapeAttr(s: string | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Turns an OpenAI / transport error into a user-facing message that points at
 * the most likely fix (bad API key, out of credit, rate limit, wrong model,
 * bad request, timeout, or network failure).
 */
export function friendlyAudioError(err: unknown): string {
  const e = (err ?? {}) as {
    status?: number | null;
    code?: string | null;
    type?: string | null;
    message?: string;
    name?: string;
    cause?: unknown;
  };
  const status = e.status ?? undefined;
  const code = e.code ?? undefined;
  const type = e.type ?? undefined;
  const msg = e.message ?? "";
  const msgLower = msg.toLowerCase();

  // Unwrap Node / undici system error codes from the cause chain.
  let causeCode: string | undefined;
  let causeMsg = "";
  const cause = e.cause;
  if (cause instanceof Error) {
    causeMsg = cause.message;
    const c = cause as { code?: unknown };
    if (typeof c.code === "string") causeCode = c.code;
  }

  const codeStr = typeof code === "string" ? code.toLowerCase() : undefined;
  const typeStr = typeof type === "string" ? type.toLowerCase() : undefined;
  const causeMsgLower = causeMsg.toLowerCase();

  // Synthesis ran out of its wall-clock budget — the TTS model in use is too
  // slow to render a whole episode inside the serverless function's limit.
  if (msgLower.includes("time budget")) {
    return `Speech synthesis took too long to finish. The configured TTS model is too slow to render a full episode — set OPENAI_TTS_MODEL to "tts-1" and try again.`;
  }

  // 401 — bad / missing API key
  if (status === 401) {
    return "The OpenAI API key is invalid or not set. Check your OPENAI_API_KEY.";
  }

  // 429 with insufficient_quota → out of credit (billing)
  if (status === 429 && (codeStr === "insufficient_quota" || typeStr === "insufficient_quota")) {
    return "Your OpenAI account is out of credit. Add funds at platform.openai.com/account/billing and try again.";
  }

  // 429 → rate limit
  if (status === 429) {
    return "OpenAI is rate-limiting requests. Wait a moment and try again, or lower your usage.";
  }

  // 404 / model_not_found
  if (status === 404 || codeStr === "model_not_found") {
    return `The configured model was not found. Check OPENAI_CHAT_MODEL and OPENAI_TTS_MODEL.`;
  }

  // 400 / 422 — request rejected
  if (status === 400 || status === 422) {
    return `OpenAI rejected the request (${status}): ${msg}.`;
  }

  // Timeouts (OpenAI APIConnectionTimeoutError, abort timeouts, ETIMEDOUT cause)
  const isTimeout =
    typeStr?.includes("timeout") ||
    causeCode === "ETIMEDOUT" ||
    msgLower.includes("timed out") ||
    msgLower.includes("timeout") ||
    causeMsgLower.includes("timed out") ||
    causeMsgLower.includes("timeout");
  if (isTimeout) {
    return "The request to OpenAI timed out. Try again later.";
  }

  // Network errors: no HTTP status (transport-level failure)
  const isNetwork =
    status === undefined &&
    (causeCode === "ECONNRESET" ||
      causeCode === "ENOTFOUND" ||
      causeCode === "ECONNREFUSED" ||
      causeCode === "EAI_AGAIN" ||
      causeCode === "EHOSTUNREACH" ||
      causeCode === "ENETUNREACH" ||
      msgLower.includes("fetch failed") ||
      msgLower.includes("network") ||
      msgLower.includes("connect"));
  if (isNetwork) {
    return "Could not reach OpenAI. Check your network connection and OPENAI_BASE_URL.";
  }

  return msg || "Audio generation failed";
}

/**
 * Runs the full audio-overview pipeline for a notebook: assemble context
 * from ready sources -> generate a two-host dialogue script -> synthesize
 * each line with a distinct voice -> concatenate -> persist.
 *
 * Called via Next's `after()` so it runs post-response without blocking the
 * request, and reports live progress through Redis for polling, same as
 * the source ingest pipeline.
 */
export async function runAudioPipeline(audioId: string) {
  // Fetch the overview inside the try so a DB failure (or a missing row) is
  // caught and recorded as FAILED instead of silently returning and leaving
  // the row stuck in QUEUED with no error surfaced.
  try {
    const overview = await withDbRetry(() => db.audioOverview.findUnique({ where: { id: audioId } }));
    if (!overview) return;

    // Throttled "still working" signal written to the row while TTS runs.
    const lastHeartbeatAt = { current: 0 };

    await mark(overview.id, "SCRIPTING", "Reading through your sources", 10);
    const sources = await db.source.findMany({
      where: overview.sourceId
        ? { id: overview.sourceId, notebookId: overview.notebookId, status: "READY" }
        : { notebookId: overview.notebookId, status: "READY" },
      select: { title: true, rawText: true, type: true },
    });

    if (!sources.length) {
      throw new Error(
        overview.sourceId
          ? "This source is no longer available to summarize"
          : "No indexed sources are available to summarize yet"
      );
    }

    // Split the character budget evenly across however many sources are
    // actually present. With the old fixed 3000-char-per-source cap, a
    // notebook with a single source only ever contributed ~3000 chars even
    // though the full ~14000-char budget was available — starving the
    // script model of context and producing a noticeably thin, generic
    // "podcast" for single-file notebooks. Sharing the budget dynamically
    // means one source gets (up to) the whole budget, five sources split it
    // five ways, etc.
    const perSourceChars = Math.max(3000, Math.floor(MAX_CONTEXT_CHARS / sources.length));

    const context = sources
      .map(
        (s: { title: string; rawText: string | null; type: string }) =>
          `<source id="${escapeAttr(s.title)}" type="${s.type}">\n${(s.rawText ?? "").slice(0, perSourceChars)}\n</source>`
      )
      .join("\n\n")
      .slice(0, MAX_CONTEXT_CHARS);

    await mark(overview.id, "SCRIPTING", "Writing the podcast script", 25);
    const lines = await generateAudioScript(context);

    await withDbRetry(() => db.audioOverview.update({ where: { id: overview.id }, data: { script: lines } }));

    await mark(overview.id, "SYNTHESIZING", `Recording ${lines.length} lines`, 45);
    const audioData = await synthesizeAudioScript(
      lines,
      { A: overview.voiceA, B: overview.voiceB },
      (done, total) => {
        const percent = 45 + Math.round((done / total) * (88 - 45));
        void setAudioProgress(overview.id, {
          status: "SYNTHESIZING",
          step: `Recording line ${done} of ${total}`,
          percent,
          updatedAt: Date.now(),
        });
        // Also touch the row so the "is this job still alive?" check sees
        // recent activity even when Redis is unavailable. Throttled to at
        // most one write every 30s — TTS lines take 30-125s each, so this
        // fires roughly once per line.
        const now = Date.now();
        if (now - lastHeartbeatAt.current > 30_000) {
          lastHeartbeatAt.current = now;
          void withDbRetry(() =>
            db.audioOverview.update({ where: { id: overview.id }, data: { updatedAt: new Date() } })
          ).catch(() => {});
        }
      },
      // The whole job runs inside a serverless function that the platform
      // kills at 300s. Give synthesis a slice of that and let it fail with a
      // real reason rather than being cut off mid-way with nothing to show.
      { deadlineMs: TTS_DEADLINE_MS }
    );

    // Rough duration estimate: ~150 words/minute spoken, used for display
    // only (not exact — swap for real MP3 duration parsing if needed).
    const wordCount = lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
    const durationSec = Math.round((wordCount / 150) * 60);

    await mark(overview.id, "SYNTHESIZING", "Finalizing audio", 90);

    // Store the MP3 in Cloudinary when configured — keeps the (often
    // multi-MB) audio out of Postgres. `audioData` bytes are still filled
    // in as a fallback if Cloudinary isn't configured or the upload fails,
    // so playback never breaks either way.
    let audioUrl: string | null = null;
    let audioPublicId: string | null = null;
    if (cloudinaryEnabled()) {
      try {
        const publicId = `footnote/audio/${overview.notebookId}/${overview.id}`;
        const uploaded = await uploadBuffer(audioData, {
          resourceType: "video",
          folder: `footnote/audio/${overview.notebookId}`,
          publicId,
          filename: `${overview.id}.mp3`,
        });
        audioUrl = uploaded.url;
        audioPublicId = uploaded.publicId;
      } catch (err) {
        // The MP3 still ends up in Postgres below, so playback is unaffected —
        // but the reason belongs in the log, because the usual cause is a
        // Cloudinary API key that lacks the "upload" permission, which
        // otherwise looks like a mysterious silent downgrade.
        // eslint-disable-next-line no-console
        console.warn(
          `[audio] Cloudinary upload failed for overview ${overview.id}, falling back to inline storage. ` +
            `Check that the Cloudinary API key has upload permissions. Cause: ${describeError(err)}`
        );
      }
    }

    // The most important write in the whole pipeline: it is what makes the
    // finished audio visible. A transient database blip here would throw away
    // minutes of synthesis, so retry it.
    await withDbRetry(() =>
      db.audioOverview.update({
        where: { id: overview.id },
        data: {
          status: "READY",
          audioData: audioUrl ? null : audioData,
          audioUrl,
          audioPublicId,
          durationSec,
          errorMessage: null,
        },
      })
    );
    await setAudioProgress(overview.id, { status: "READY", percent: 100, updatedAt: Date.now() });
  } catch (err) {
    const message = friendlyAudioError(err);
    // `overview` is scoped to the try block above; re-fetch by the param id so
    // a DB error during the original lookup itself doesn't leave the row unrecorded.
    const overview = await withDbRetry(() => db.audioOverview.findUnique({ where: { id: audioId } })).catch(
      () => null
    );
    if (overview) {
      // eslint-disable-next-line no-console
      console.error(`[audio] overview ${overview.id} (notebook ${overview.notebookId}) failed:`, describeError(err));
      // Never let a failure while recording the failure escape — it would
      // reject the Inngest function and leave the row in a stale state.
      await withDbRetry(() =>
        db.audioOverview.update({
          where: { id: overview.id },
          data: { status: "FAILED", errorMessage: message },
        })
      ).catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`[audio] could not mark overview ${overview.id} as FAILED:`, describeError(e));
      });
      await setAudioProgress(overview.id, { status: "FAILED", errorMessage: message, updatedAt: Date.now() });
    } else {
      // eslint-disable-next-line no-console
      console.error(`[audio] overview ${audioId} not found during failure recovery:`, describeError(err));
    }
  }
}

async function mark(audioId: string, status: "SCRIPTING" | "SYNTHESIZING", step: string, percent: number) {
  await withDbRetry(() => db.audioOverview.update({ where: { id: audioId }, data: { status } }));
  await setAudioProgress(audioId, { status, step, percent, updatedAt: Date.now() });
}