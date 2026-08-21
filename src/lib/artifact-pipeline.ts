import { z } from "zod";
import { db } from "@/lib/db";
import { openai, CHAT_MODEL, withRetry } from "@/lib/openai";
import { setArtifactProgress } from "@/lib/redis";
import { describeError } from "@/lib/utils";
import { syncReviewCardsFromArtifact } from "@/lib/review";

const MAX_CONTEXT_CHARS = 60_000; // per-notebook budget for the generation prompt

// ---------------------------------------------------------------------------
// Ported from sourcelm's artifact-generation.service.ts: one Zod schema per
// artifact type, used both to steer the model (JSON mode + a schema
// description in the prompt) and to validate its output before it's stored.
// ---------------------------------------------------------------------------

const flashcardsSchema = z.object({
  cards: z
    .array(z.object({ front: z.string(), back: z.string() }))
    .min(3)
    .max(30),
});

const quizSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).min(2).max(5),
        correctIndex: z.number().int().min(0),
        explanation: z.string(),
      })
    )
    .min(3)
    .max(15),
});

const mindmapSchema = z.object({
  nodes: z
    .array(z.object({ id: z.string(), label: z.string() }))
    .min(2)
    .max(40),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string() })),
});

const takeawaysSchema = z.object({
  items: z.array(z.string()).min(3).max(20),
});

/** Recursively flattens whatever shape the model returned (string, array of
 *  strings, array of {text}/{content} objects, nested arrays, etc.) into a
 *  single plain-text string, so minor shape drift in JSON-mode output never
 *  fails validation. */
function flattenToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenToText).filter(Boolean).join("\n\n");
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const candidate = obj.text ?? obj.content ?? obj.value ?? obj.markdown;
    if (typeof candidate === "string") return candidate;
    return Object.values(obj).map(flattenToText).filter(Boolean).join("\n\n");
  }
  return "";
}

const reportSchema = z.object({
  markdown: z.string(),
  sections: z
    .array(
      z.object({
        title: z.string(),
        content: z.unknown().transform(flattenToText),
      })
    )
    .optional()
    .default([]),
});

export type ArtifactType = "SUMMARY" | "TAKEAWAYS" | "FLASHCARDS" | "QUIZ" | "MINDMAP" | "REPORT";

/** Collects text from a notebook's READY sources for artifact generation,
 *  scoped to `sourceIds` when given, otherwise every ready source. */
async function gatherSourceContext(notebookId: string, sourceIds: string[]) {
  const sources: { id: string; title: string; rawText: string | null }[] = await db.source.findMany({
    where: { notebookId, status: "READY" },
    select: { id: true, title: true, rawText: true },
  });

  const selected = sourceIds.length ? sources.filter((s) => sourceIds.includes(s.id)) : sources;

  const withContent = selected.flatMap((s) => {
    const content = s.rawText?.trim();
    return content ? [{ title: s.title, content }] : [];
  });

  if (withContent.length === 0) {
    throw new Error("Selected sources have no extracted content yet.");
  }

  const perSourceChars = Math.max(4000, Math.floor(MAX_CONTEXT_CHARS / withContent.length));
  const text = withContent
    .map((s: { title: string; content: string }) => `# ${s.title}\n\n${s.content.slice(0, perSourceChars)}`)
    .join("\n\n---\n\n")
    .slice(0, MAX_CONTEXT_CHARS);

  return { text, sourceIds: selected.map((s) => s.id) };
}

async function callJsonModel<T>(prompt: string, schema: z.ZodType<T>, system: string): Promise<T> {
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
}

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
        `Extract the most important key takeaways as concise bullet points, shape { "items": string[] }, from:\n\n${sourceText}`,
        takeawaysSchema,
        system
      );
    case "FLASHCARDS":
      return callJsonModel(
        `Create study flashcards, shape { "cards": [{ "front": "...", "back": "..." }] }, covering the main concepts from:\n\n${sourceText}`,
        flashcardsSchema,
        system
      );
    case "QUIZ":
      return callJsonModel(
        `Create a multiple-choice quiz, shape { "questions": [{ "question": "...", "options": string[], "correctIndex": number, "explanation": "..." }] }, from:\n\n${sourceText}`,
        quizSchema,
        system
      );
    case "MINDMAP":
      return callJsonModel(
        `Create a mind map, shape { "nodes": [{ "id": "...", "label": "..." }], "edges": [{ "id": "...", "source": "...", "target": "..." }] }. Use a central topic node and branch out logically from:\n\n${sourceText}`,
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
    await syncReviewCardsFromArtifact(updated).catch(() => {});
  } catch (err) {
    const message = describeError(err);
    await db.artifact.update({ where: { id: artifact.id }, data: { status: "FAILED", errorMessage: message } });
    await mark(artifact.id, "FAILED", "Generation failed", 100, message);
  }
}