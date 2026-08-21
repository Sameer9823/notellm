import { embedQuery, openai, CHAT_MODEL, generateHydePassage } from "@/lib/openai";
import { searchNotebook, type ChunkPayload } from "@/lib/qdrant";
import { tavilySearch } from "@/lib/tavily";

export type RetrievedChunk = ChunkPayload & { score: number; url?: string };

const SIMILARITY_FLOOR = 0.15; // below this, a chunk is noise, not context
// Slightly more permissive floor for the HyDE retry: the hypothetical
// passage is a looser proxy for "what's relevant" than the literal
// question, so we accept a little more noise there in exchange for
// recovering chunks a direct-question embedding would have missed.
const HYDE_SIMILARITY_FLOOR = 0.12;

export async function retrieve(
  notebookId: string,
  question: string,
  k = 8,
  sourceId?: string | null
): Promise<RetrievedChunk[]> {
  const vector = await embedQuery(question);
  const hits = await searchNotebook(notebookId, vector, k, sourceId);
  return hits
    .filter((h) => h.score >= SIMILARITY_FLOOR)
    .map((h) => ({ ...h.payload, score: h.score }));
}

/** Second-chance retrieval using HyDE: embeds a short hypothetical answer
 *  passage instead of the literal question, and searches again. Only
 *  called when the direct retrieval above comes back empty. */
export async function retrieveWithHyde(
  notebookId: string,
  question: string,
  k = 8,
  sourceId?: string | null
): Promise<RetrievedChunk[]> {
  const hydePassage = await generateHydePassage(question);
  const vector = await embedQuery(hydePassage);
  const hits = await searchNotebook(notebookId, vector, k, sourceId);
  return hits
    .filter((h) => h.score >= HYDE_SIMILARITY_FLOOR)
    .map((h) => ({ ...h.payload, score: h.score }));
}

/** Live web search (Tavily), reshaped into the same RetrievedChunk shape as
 *  notebook chunks so it can be dropped straight into the same numbered
 *  context / citation pipeline. Best-effort — a Tavily failure (or no key
 *  configured) just means the web results are skipped, not a hard error;
 *  the caller still gets whatever notebook context it found. */
export async function retrieveWeb(question: string, limit = 4): Promise<RetrievedChunk[]> {
  try {
    const results = await tavilySearch(question, limit);
    return results.map((r, i) => ({
      notebookId: "",
      sourceId: `web:${r.url}`,
      sourceTitle: r.title,
      sourceType: "WEB",
      chunkId: `web:${r.url}:${i}`,
      index: i,
      content: r.snippet,
      score: 1,
      url: r.url,
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[rag] Web search failed, continuing without it:", err);
    return [];
  }
}

function buildContext(chunks: RetrievedChunk[]) {
  return chunks
    .map((c, i) => `[${i + 1}] Source: "${c.sourceTitle}"${c.sourceType === "WEB" ? " (live web result)" : ""}\n${c.content}`)
    .join("\n\n---\n\n");
}

const SYSTEM_PROMPT = `You are the answer engine inside a research notebook app. You must answer ONLY using the numbered context passages provided for this turn — never your own outside knowledge.

Rules:
- Every factual sentence must end with one or more bracket citations referencing the passage number(s) it came from, e.g. [1] or [1][3].
- If the passages don't contain enough information to answer, say so plainly and do not guess.
- Be concise and well-formatted: use short paragraphs, bullet lists for multi-part answers, and bold sparingly for key terms.
- Never fabricate a citation number that wasn't provided.`;

// Used only when nothing in the notebook — not even via the HyDE retry —
// is close enough to count as real context. The model answers from general
// knowledge instead, but is required to flag that clearly up front so it's
// never mistaken for a grounded, cited answer.
const OUT_OF_SOURCE_SYSTEM_PROMPT = `You are the answer engine inside a research notebook app. For this turn, nothing in the user's uploaded sources was close enough to the question to use as context.

Rules:
- Start your reply with exactly this line, verbatim: "⚠️ Not found in your sources — here's a brief general answer:"
- Then give a short, helpful answer from your own general knowledge (3-6 sentences max). Do not use bracket citations like [1] — there is no source context this turn.
- End with a short line inviting the user to ask something grounded in their notebook's sources instead, or to add a source that covers this topic.
- Do not claim this information came from the notebook's sources.`;

export async function streamAnswer(
  notebookId: string,
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
  sourceId?: string | null,
  memoryContext?: string,
  webSearchEnabled = false
) {
  // Ported from sourcelm's Mem0-backed memory feature: durable facts about
  // the user (see src/lib/memory.ts) are appended as extra context so the
  // model can personalize tone/examples without treating them as citable
  // source material.
  const memoryBlock = memoryContext?.trim()
    ? `\n\nWhat you know about this user from past conversations (for tone/context only — never cite these as sources):\n${memoryContext}`
    : "";
  let chunks = await retrieve(notebookId, question, 8, sourceId);
  let usedHyde = false;

  // Nothing close enough on the literal question — try again with a HyDE
  // hypothetical-answer embedding before giving up on grounded context.
  if (!chunks.length) {
    try {
      chunks = await retrieveWithHyde(notebookId, question, 8, sourceId);
      usedHyde = chunks.length > 0;
    } catch {
      // HyDE is a best-effort enhancement — fall through to out-of-source
      // handling below if it fails for any reason (e.g. rate limit).
    }
  }

  // Web search is additive, not a replacement: it runs regardless of
  // whether notebook retrieval found anything, so a question that's half
  // "what does my source say" and half "what's the latest on this" can
  // pull from both in one answer, numbered together.
  if (webSearchEnabled) {
    const webChunks = await retrieveWeb(question);
    chunks = [...chunks, ...webChunks];
  }

  if (!chunks.length) {
    // Still nothing grounded: stream a clearly-labeled general-knowledge
    // answer rather than a flat refusal, so the user always gets *some*
    // useful response, with an unambiguous "not in your sources" flag.
    const stream = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: "system" as const, content: OUT_OF_SOURCE_SYSTEM_PROMPT + memoryBlock },
        ...history.slice(-6),
        { role: "user" as const, content: question },
      ],
      stream: true,
      temperature: 0.4,
    });
    return { chunks, stream, noContext: true as const, usedHyde: false };
  }

  const context = buildContext(chunks);
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT + memoryBlock },
    ...history.slice(-6),
    {
      role: "user" as const,
      content: `Context passages:\n\n${context}\n\n---\n\nQuestion: ${question}`,
    },
  ];

  const stream = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    stream: true,
    temperature: 0.2,
  });

  return { chunks, stream, noContext: false as const, usedHyde };
}

/** Maps [1][2] style citation markers found in the answer text back to the
 *  chunks that were actually retrieved, deduped and in first-seen order. */
export function extractCitations(answerText: string, chunks: RetrievedChunk[]) {
  const used = new Set<number>();
  const regex = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(answerText))) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < chunks.length) used.add(idx);
  }
  return [...used].map((i) => {
    const c = chunks[i];
    return {
      marker: i + 1,
      chunkId: c.chunkId,
      sourceId: c.sourceId,
      sourceTitle: c.sourceTitle,
      sourceType: c.sourceType,
      page: c.page,
      startSec: c.startSec,
      endSec: c.endSec,
      snippet: c.content.slice(0, 220),
      url: c.url,
    };
  });
}