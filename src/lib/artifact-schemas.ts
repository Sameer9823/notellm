import { z } from "zod";

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

// ---------------------------------------------------------------------------
// Zod schemas for study artifacts, used both to steer the model (JSON mode)
// and to validate its output before it's stored.
//
// Design notes:
// - `.max(N)` is intentionally replaced with `.transform(arr => arr.slice(0, N))`
//   so the model can return extra items without the *entire* generation failing.
//   The schema truncates and continues; only the hard floor (`.min(N)`) is a
//   real validation gate.
// - Quiz and mind-map have normalizer transforms that drop invalid entries
//   (out-of-range correctIndex, dangling edges, self-edges, duplicate node ids)
//   so a single bad item doesn't sink the whole batch.
// ---------------------------------------------------------------------------

const flashcardSchema = z.object({ front: z.string(), back: z.string() });
export const flashcardsSchema = z.object({
  cards: flashcardSchema.array().min(3).transform((arr) => arr.slice(0, 30)),
});

const quizQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).min(2).max(5),
  correctIndex: z.number().int().min(0),
  explanation: z.string(),
});

export const quizSchema = z.object({
  questions: quizQuestionSchema
    .array()
    .transform((arr) => arr.filter((q) => q.correctIndex < q.options.length))
    .transform((arr) => arr.slice(0, 15))
    .refine((arr) => arr.length >= 3, { message: "At least 3 valid questions required" }),
});

export const mindmapSchema = z
  .object({
    nodes: z
      .object({ id: z.string(), label: z.string() })
      .array()
      .transform((arr) => {
        const seen = new Set<string>();
        return arr.filter((n) => {
          if (seen.has(n.id)) return false;
          seen.add(n.id);
          return true;
        });
      })
      .transform((arr) => arr.slice(0, 40))
      .refine((arr) => arr.length >= 2, { message: "At least 2 mind map nodes required" }),
    edges: z.object({ id: z.string(), source: z.string(), target: z.string() }).array(),
  })
  .transform((data) => {
    const nodeIds = new Set(data.nodes.map((n) => n.id));
    const edges = data.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target
    );
    return { ...data, edges };
  });

export const takeawaysSchema = z.object({
  items: z.string().array().min(3).transform((arr) => arr.slice(0, 20)),
});

export const reportSchema = z.object({
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
