import { v4 as uuid } from "uuid";
import { db } from "@/lib/db";
import { setProgress } from "@/lib/redis";
import { embedTexts, detectLanguage, translateCuesToEnglish } from "@/lib/openai";
import { upsertChunks, deleteBySourceExcept } from "@/lib/qdrant";
import { chunkPlainText, chunkPages, chunkCues, type TextChunk, type Cue } from "@/lib/chunking";
import { extractPdf } from "@/lib/extractors/pdf";
import { extractUrl } from "@/lib/extractors/url";
import { extractYoutube } from "@/lib/extractors/youtube";
import { extractVtt } from "@/lib/extractors/vtt";
import { describeError } from "@/lib/utils";
import type { Source } from "@prisma/client";

/** Detects the language of a cue-based transcript from a text sample and,
 *  if it isn't English, translates every cue to English in place (keeping
 *  timestamps untouched). Always returns cues that are safe to display and
 *  index as English, plus the ISO code of the *original* spoken language
 *  for display (e.g. "Transcribed from Hindi"). Never throws — translation
 *  is best-effort and falls back to the original cues on any failure. */
async function ensureEnglishCues(cues: Cue[]): Promise<{ cues: Cue[]; language: string }> {
  const sample = cues
    .slice(0, 40)
    .map((c) => c.text)
    .join(" ");
  const language = await detectLanguage(sample);
  if (language === "en") return { cues, language };
  try {
    const translated = await translateCuesToEnglish(cues);
    return { cues: translated, language };
  } catch {
    return { cues, language };
  }
}

/**
 * Runs the full ingest pipeline for a source: extract -> chunk -> embed ->
 * upsert into Qdrant -> persist chunk rows -> flip status to READY.
 * Any failure is caught, recorded on the Source row, and surfaced to the UI.
 *
 * Called via Next's `after()` so it runs post-response without blocking the
 * upload request, and reports live progress through Redis for polling.
 */
export async function runIngestPipeline(sourceId: string) {
  const source = await db.source.findUnique({
    where: { id: sourceId },
    include: { sourceFile: true },
  });
  if (!source) return;

  try {
    await mark(source.id, "INDEXING", "Extracting content", 10);
    const { chunks, metadata } = await extractAndChunk(source);

    if (!chunks.length) {
      throw new Error("No extractable content was found in this source");
    }

    // For URL/YOUTUBE sources, `metadata.title` (if present) is the real
    // fetched page/video title — the Source row is first created with the
    // raw URL as a placeholder title, and extraction resolves the real one.
    // Resolve it *before* writing the Qdrant payload below so citations in
    // chat (which read `sourceTitle` off the chunk payload, not Postgres)
    // show the actual title instead of the raw URL/video id.
    const resolvedTitle =
      typeof metadata.title === "string" && metadata.title.trim().length > 0 ? metadata.title : source.title;

    await mark(source.id, "INDEXING", `Embedding ${chunks.length} chunks`, 45);
    const vectors = await embedTexts(chunks.map((c) => c.content));

    await mark(source.id, "INDEXING", "Writing to vector index", 80);
    const chunkRows = chunks.map((c, i) => ({
      id: uuid(),
      chunk: c,
      vector: vectors[i],
    }));

    // Non-atomic reindex safety: upsert NEW points first, swap Postgres in a
    // transaction, THEN delete the OLD Qdrant points (excluding the new ids).
    // If anything fails, the source keeps its previous working index.
    await upsertChunks(
      chunkRows.map((r) => ({
        id: r.id,
        vector: r.vector,
        payload: {
          notebookId: source.notebookId,
          sourceId: source.id,
          sourceTitle: resolvedTitle,
          sourceType: source.type,
          chunkId: r.id,
          index: r.chunk.index,
          content: r.chunk.content,
          page: r.chunk.page,
          startSec: r.chunk.startSec,
          endSec: r.chunk.endSec,
          startChar: r.chunk.startChar,
          endChar: r.chunk.endChar,
          originUrl: source.originUrl ?? undefined,
        },
      }))
    );

    // Swap the Postgres chunk rows atomically — if createMany rolls back,
    // the old rows still match the old Qdrant vectors.
    await db.$transaction(async (tx) => {
      await tx.chunk.deleteMany({ where: { sourceId: source.id } });
      await tx.chunk.createMany({
        data: chunkRows.map((r) => ({
          id: r.id,
          sourceId: source.id,
          notebookId: source.notebookId,
          index: r.chunk.index,
          content: r.chunk.content,
          tokenCount: r.chunk.tokenCount,
          startChar: r.chunk.startChar,
          endChar: r.chunk.endChar,
          page: r.chunk.page,
          startSec: r.chunk.startSec,
          endSec: r.chunk.endSec,
          vectorId: r.id,
        })),
      });
    });

    // Only after Postgres is swapped do we remove the old Qdrant points,
    // preserving the freshly-upserted new ids so they don't get deleted.
    await deleteBySourceExcept(source.id, chunkRows.map((r) => r.id));

    await db.source.update({
      where: { id: source.id },
      data: {
        status: "READY",
        chunkCount: chunkRows.length,
        indexedAt: new Date(),
        errorMessage: null,
        ...metadata,
      },
    });
    await setProgress(source.id, { status: "READY", percent: 100, updatedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Indexing failed";
    // eslint-disable-next-line no-console
    console.error(`[ingest] source ${source.id} (${source.type} "${source.title}") failed:`, describeError(err));
    await db.source.update({
      where: { id: source.id },
      data: { status: "FAILED", errorMessage: message },
    });
    await setProgress(source.id, { status: "FAILED", errorMessage: message, updatedAt: Date.now() });
  }
}

async function mark(sourceId: string, status: "INDEXING", step: string, percent: number) {
  await db.source.update({ where: { id: sourceId }, data: { status } });
  await setProgress(sourceId, { status, step, percent, updatedAt: Date.now() });
}

/** Fetches a file previously uploaded to Cloudinary (or any https URL) back
 *  into memory for extraction. */
async function fetchStoredFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch stored file (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function extractAndChunk(
  source: Source & { sourceFile?: { data: Uint8Array } | null }
): Promise<{ chunks: TextChunk[]; metadata: Record<string, unknown> }> {
  switch (source.type) {
    case "TEXT": {
      const chunks = chunkPlainText(source.rawText ?? "");
      return { chunks, metadata: {} };
    }
    case "URL": {
      const result = await extractUrl(source.originUrl!);
      const chunks = chunkPlainText(result.text);
      return {
        chunks,
        metadata: {
          title: source.title === source.originUrl ? result.title : source.title,
          rawText: result.text.slice(0, 4000),
          metadata: { siteName: result.siteName, byline: result.byline },
        },
      };
    }
    case "PDF": {
      // Prefer the Cloudinary-hosted original (storagePath) when present;
      // fall back to the SourceFile table (local bytes from the fallback
      // upload path) when storagePath is null; as a last resort decode the
      // transient base64 rawText (legacy sources created before either path
      // existed, where the PDF was only ever available via rawText).
      let buffer: Buffer;
      if (source.storagePath) {
        buffer = await fetchStoredFile(source.storagePath);
      } else if (source.sourceFile?.data) {
        buffer = Buffer.from(source.sourceFile.data);
      } else {
        buffer = Buffer.from(source.rawText ?? "", "base64");
      }
      const result = await extractPdf(buffer);
      const chunks = chunkPages(result.pages);
      return {
        chunks,
        metadata: { pageCount: result.pageCount, rawText: result.fullText.slice(0, 4000) },
      };
    }
    case "YOUTUBE": {
      const result = await extractYoutube(source.originUrl!);
      // Captions come back in whatever language the video was captioned
      // in (Hindi, Spanish, etc.) — translate to English before chunking
      // so the transcript panel, chat citations, and RAG context are
      // always readable regardless of the source video's spoken language.
      const { cues, language } = await ensureEnglishCues(result.cues);
      const chunks = chunkCues(cues);
      return {
        chunks,
        metadata: {
          title: source.title === source.originUrl ? result.title : source.title,
          durationSec: result.durationSec,
          language,
          metadata: { videoId: result.videoId },
          rawText: cues.map((c) => c.text).join(" ").slice(0, 4000),
        },
      };
    }
    case "VTT": {
      const result = extractVtt(source.rawText ?? "");
      const { cues, language } = await ensureEnglishCues(result.cues);
      const chunks = chunkCues(cues);
      return {
        chunks,
        metadata: {
          durationSec: result.durationSec,
          language,
          rawText: cues.map((c) => c.text).join(" ").slice(0, 4000),
        },
      };
    }
    default:
      throw new Error(`Unsupported source type: ${source.type}`);
  }
}