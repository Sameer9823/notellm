import { db } from "@/lib/db";
import { setAudioProgress } from "@/lib/redis";
import { generateAudioScript, synthesizeAudioScript } from "@/lib/openai";
import { describeError } from "@/lib/utils";
import { cloudinaryEnabled, uploadBuffer } from "@/lib/cloudinary";

const MAX_CONTEXT_CHARS = 14000; // keep the script-generation prompt bounded

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
  const overview = await db.audioOverview.findUnique({ where: { id: audioId } });
  if (!overview) return;

  try {
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

    await db.audioOverview.update({ where: { id: overview.id }, data: { script: lines } });

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
      }
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
        const uploaded = await uploadBuffer(audioData, {
          resourceType: "video", // Cloudinary serves audio formats under its "video" resource type
          folder: `footnote/audio/${overview.notebookId}`,
          filename: `audio-overview-${overview.id}.mp3`,
        });
        audioUrl = uploaded.url;
        audioPublicId = uploaded.publicId;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[audio] Cloudinary upload failed for overview ${overview.id}, falling back to inline storage:`, err);
      }
    }

    await db.audioOverview.update({
      where: { id: overview.id },
      data: {
        status: "READY",
        audioData: audioUrl ? null : audioData,
        audioUrl,
        audioPublicId,
        durationSec,
        errorMessage: null,
      },
    });
    await setAudioProgress(overview.id, { status: "READY", percent: 100, updatedAt: Date.now() });
  } catch (err) {
    const message = friendlyAudioError(err);
    // eslint-disable-next-line no-console
    console.error(`[audio] overview ${overview.id} (notebook ${overview.notebookId}) failed:`, describeError(err));
    await db.audioOverview.update({
      where: { id: overview.id },
      data: { status: "FAILED", errorMessage: message },
    });
    await setAudioProgress(overview.id, { status: "FAILED", errorMessage: message, updatedAt: Date.now() });
  }
}

async function mark(audioId: string, status: "SCRIPTING" | "SYNTHESIZING", step: string, percent: number) {
  await db.audioOverview.update({ where: { id: audioId }, data: { status } });
  await setAudioProgress(audioId, { status, step, percent, updatedAt: Date.now() });
}