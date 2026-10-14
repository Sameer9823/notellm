import { z } from "zod";
import { db } from "@/lib/db";
import { openai, CHAT_MODEL, withRetry } from "@/lib/openai";
import { setArtifactProgress } from "@/lib/redis";
import { describeError } from "@/lib/utils";
import { CREDIT_COSTS, refundCredits } from "@/lib/credits";
import { syncReviewCardsFromArtifact } from "@/lib/review";
import { flashcardsSchema, quizSchema, mindmapSchema, takeawaysSchema, reportSchema } from "@/lib/artifact-schemas";

const MAX_CONTEXT_CHARS = 60_000; // per-notebook budget for the generation prompt

// ---------------------------------------------------------------------------
// Ported from sourcelm's artifact-generation.service.ts: one Zod schema per
// artifact type, used both to steer the model (JSON mode + a schema
// description in the prompt) and to validate its output before it's stored.
//
// Design notes:
// - `.max(N)` is intentionally replaced with `.transform(arr => arr.slice(0, N))`
//   so the model can return extra items without the *entire* generation failing.
//   The schema truncates and continues; only the hard floor (`.min(N)`) is a
//   real validation gate.
// - Quiz and mind-map have normalizer transforms that drop invalid entries
//   (out-of-range correctIndex, dangling edges, self-edges, duplicate node ids)
//   so a single bad item doesn't sink the whole batch.
// - Schemas live in lib/artifact-schemas.ts so they're testable without db/openai.
// ---------------------------------------------------------------------------

/** Generates type-specific content for one artifact from a block of source text. */
/** Collects text from a notebook's READY sources for artifact generation,
 *  scoped to `sourceIds` when given, otherwise every ready source.
 *
 *  Loads Chunk rows instead of Source.rawText: ingest only stores
 *  `.slice(0, 4000)` of rawText for URL/PDF/YOUTUBE/VTT sources, so artifacts
 *  based on rawText would only see the first ~4000 chars. Chunks contain the
 *  full extracted content across all pages/timestamps. */
async function gatherSourceContext(notebookId: string, sourceIds: string[]) {
  const sources = await db.source.findMany({
    where: { notebookId, status: "READY" },
    select: { id: true, title: true, rawText: true },
  });

  const selected = sourceIds.length ? sources.filter((s) => sourceIds.includes(s.id)) : sources;

  // Load all chunks for the selected sources in one query, ordered by
  // source then chunk index so the text reads top-to-bottom.
  const chunks = await db.chunk.findMany({
    where: { sourceId: { in: selected.map((s) => s.id) } },
    orderBy: [{ sourceId: "asc" }, { index: "asc" }],
    select: { sourceId: true, content: true },
  });

  // Group chunks by sourceId so we can preserve per-source attribution.
  const bySource = new Map<string, string[]>();
  for (const c of chunks) {
    (bySource.get(c.sourceId) ?? bySource.set(c.sourceId, []).get(c.sourceId)!).push(c.content);
  }

  const withContent: { title: string; content: string }[] = [];
  for (const s of selected) {
    const sourceChunks = bySource.get(s.id);
    if (sourceChunks && sourceChunks.length > 0) {
      // Chunks overlap slightly (~80 tokens); the small duplication is
      // acceptable since it's fed to an LLM that tolerates redundancy, and
      // avoids losing boundary sentences that a naive dedupe could drop.
      const content = sourceChunks.join("\n\n").trim();
      if (content) withContent.push({ title: s.title, content });
    } else if (s.rawText?.trim()) {
      // Fall back to rawText when a source has no chunks yet
      withContent.push({ title: s.title, content: s.rawText.trim() });
    }
  }

  if (withContent.length === 0) {
    throw new Error("Selected sources have no extracted content yet.");
  }

  const perSourceChars = Math.max(4000, Math.floor(MAX_CONTEXT_CHARS / withContent.length));
  const text = withContent
    .map((s) => `# ${s.title}\n\n${s.content.slice(0, perSourceChars)}`)
    .join("\n\n---\n\n")
    .slice(0, MAX_CONTEXT_CHARS);

  return { text, sourceIds: selected.map((s) => s.id) };
}

async function callJsonModel<T>(prompt: string, schema: z.ZodType<T>, system: string): Promise<T> {
  const generate = async (): Promise<T> => {
    const res = await withRetry(() =>
      openai.chat.completions.create({
        model: CHAT_MODEL,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      })
    );
    const raw = res.choices[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Model returned invalid JSON");
    }
    return schema.parse(parsed);
  };

  const retryWithFeedback = async (feedback: string): Promise<T> => {
    const res = await withRetry(() =>
      openai.chat.completions.create({
        model: CHAT_MODEL,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${prompt}\n\nThe previous response failed validation:\n${feedback}\nPlease fix and return valid JSON.` },
        ],
      })
    );
    const raw = res.choices[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Model returned invalid JSON on retry");
    }
    return schema.parse(parsed);
  };

  try {
    return await generate();
  } catch (err) {
    if (err instanceof z.ZodError) {
      // Retry once, feeding the validation errors back to the model so it
      // can correct the shape on the second pass.
      const feedback = err.issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
      // eslint-disable-next-line no-console
      console.error("[artifact] validation failed, retrying once:", feedback);
      return await retryWithFeedback(feedback);
    }
    throw err;
  }
}

export type ArtifactType = "SUMMARY" | "TAKEAWAYS" | "FLASHCARDS" | "QUIZ" | "MINDMAP" | "REPORT";

/** Generates type-specific content for one artifact from a block of source text. */
export async function generateArtifactContent(type: ArtifactType, sourceText: string) {
  const system = [
    `You are the study-tools engine inside a research notebook app, generating a ${type.toLowerCase()} from the user's notebook sources.`,
    "Use ONLY the provided source content. Do not invent facts not supported by the sources.",
    "Be clear, educational, and well-structured. Respond with ONLY a JSON object matching the requested shape — no prose, no markdown fences.",
  ].join("\n");

  switch (type) {
    case "SUMMARY": {
      const schema = z.object({ markdown: z.string() });
      return callJsonModel(
        `Write a comprehensive markdown summary as { "markdown": "..." } of the following sources:\n\n${sourceText}`,
        schema,
        system
      );
    }
    case "TAKEAWAYS":
      return callJsonModel(
        `Extract 8-15 key takeaways as concise bullet points, shape { "items": string[] }, from:\n\n${sourceText}`,
        takeawaysSchema,
        system
      );
    case "FLASHCARDS":
      return callJsonModel(
        `Generate 10-20 flashcards, shape { "cards": [{ "front": "...", "back": "..." }] }, covering the main concepts from:\n\n${sourceText}`,
        flashcardsSchema,
        system
      );
    case "QUIZ":
      return callJsonModel(
        `Generate 8-12 multiple-choice questions, each with exactly 4 options, shape { "questions": [{ "question": "...", "options": string[], "correctIndex": number, "explanation": "..." }] }, from:\n\n${sourceText}`,
        quizSchema,
        system
      );
    case "MINDMAP":
      return callJsonModel(
        `Generate a mind map with 10-30 nodes, shape { "nodes": [{ "id": "...", "label": "..." }], "edges": [{ "id": "...", "source": "...", "target": "..." }] }. Use a central topic node and branch out logically from:\n\n${sourceText}`,
        mindmapSchema,
        system
      );
    case "REPORT":
      return callJsonModel(
        `Write a structured long-form report, shape { "markdown": "...", "sections": [{ "title": "...", "content": "..." }] }, from:\n\n${sourceText}`,
        reportSchema,
        system
      );
    default:
      throw new Error(`Unsupported artifact type: ${type}`);
  }
}

async function mark(artifactId: string, status: "GENERATING" | "READY" | "FAILED", step: string, percent: number, errorMessage?: string) {
  await setArtifactProgress(artifactId, { status, step, percent, errorMessage, updatedAt: Date.now() });
}

/** Runs the full artifact pipeline for one artifact row: gather source
 *  context -> generate structured content -> persist -> (for
 *  FLASHCARDS/QUIZ) sync spaced-repetition review cards. Called via
 *  Next's `after()`, same pattern as audio/roadmap generation. */
export async function runArtifactPipeline(artifactId: string) {
  const artifact = await db.artifact.findUnique({ where: { id: artifactId } });
  if (!artifact) return;

  try {
    await mark(artifact.id, "GENERATING", "Reading through your sources", 15);
    const { text } = await gatherSourceContext(artifact.notebookId, artifact.sourceIds);

    await mark(artifact.id, "GENERATING", `Generating ${artifact.type.toLowerCase()}`, 40);
    const content = await generateArtifactContent(artifact.type as ArtifactType, text);

    const updated = await db.artifact.update({
      where: { id: artifact.id },
      data: { status: "READY", content: content as object, errorMessage: null },
    });

    await mark(artifact.id, "READY", "Done", 100);

    // Auto-creates one ReviewCard per flashcard/quiz question so the deck
    // is immediately reviewable — never blocks the artifact from finishing.
    void syncReviewCardsFromArtifact(updated).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[artifact] failed to sync review cards for ${updated.id}:`, describeError(err));
    });
  } catch (err) {
    let message: string;
    if (err instanceof z.ZodError) {
      // eslint-disable-next-line no-console
      console.error(`[artifact] validation error for artifact ${artifact.id}:`, err.issues);
      message = "The AI returned an unexpected format. Try again.";
    } else {
      message = describeError(err);
    }
    await db.artifact.update({ where: { id: artifact.id }, data: { status: "FAILED", errorMessage: message } });
    await mark(artifact.id, "FAILED", "Generation failed", 100, message);
    // Refund the artifact-generation credit on failure — the user paid
    // but got nothing usable back.
    const notebook = await db.notebook.findUnique({
      where: { id: artifact.notebookId },
      select: { ownerId: true },
    });
    if (notebook) {
      void refundCredits(notebook.ownerId, CREDIT_COSTS.artifactGenerate);
    }
  }
}