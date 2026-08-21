import { v4 as uuid } from "uuid";
import { db } from "@/lib/db";
import { openai, CHAT_MODEL, embedQuery, withRetry } from "@/lib/openai";
import { upsertMemoryVector, deleteMemoryVector, searchMemories } from "@/lib/qdrant";

/**
 * Long-term user memory, ported from sourcelm's Mem0-backed feature but
 * reimplemented directly on Postgres + the same Qdrant instance already
 * used for RAG chunks, rather than pulling in a new third-party service.
 * MANUAL memories are typed by the user in Settings > Memory; LEARNED
 * memories are extracted from chat turns by `extractMemoriesFromMessages`
 * below and injected back into future chat system prompts (see
 * src/lib/rag.ts `memoryContext`).
 *
 * Retrieval is semantic (searchMemories against the current chat turn's
 * embedding), not a flat recency window — once a user has dozens of
 * memories, an older-but-relevant fact ("prefers concise answers") should
 * still surface even if a dozen newer, unrelated ones were logged since.
 * Embedding is best-effort everywhere: if Qdrant/OpenAI hiccups, the
 * memory still saves to Postgres and getMemoryContext transparently falls
 * back to recency for rows with no vector yet.
 */

const MAX_MEMORIES_PER_USER = 200;
// Fallback window size when semantic search isn't available (no query
// text, embedding failed, or a memory has no vector yet).
const CHAT_CONTEXT_LIMIT = 12;

export async function listUserMemories(userId: string) {
  return db.userMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
}

/** Embeds a memory and upserts it into Qdrant, returning the vector id to
 *  store on the row — or null if embedding fails, so callers can save the
 *  memory to Postgres regardless. */
async function embedAndUpsert(userId: string, memory: string, source: "MANUAL" | "LEARNED"): Promise<string | null> {
  try {
    const vector = await embedQuery(memory);
    const vectorId = uuid();
    await upsertMemoryVector(vectorId, vector, { userId, memory, source });
    return vectorId;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[memory] Failed to embed memory, will fall back to recency for this row:", err);
    return null;
  }
}

export async function createMemory(userId: string, memory: string, source: "MANUAL" | "LEARNED" = "MANUAL") {
  const count = await db.userMemory.count({ where: { userId } });
  if (count >= MAX_MEMORIES_PER_USER) {
    // Drop the oldest memory to make room rather than hard-failing —
    // memory is a soft, evolving profile, not an audit log.
    const oldest = await db.userMemory.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
    if (oldest) {
      await db.userMemory.delete({ where: { id: oldest.id } });
      if (oldest.vectorId) await deleteMemoryVector(oldest.vectorId).catch(() => undefined);
    }
  }
  const trimmed = memory.trim();
  const vectorId = await embedAndUpsert(userId, trimmed, source);
  return db.userMemory.create({ data: { userId, memory: trimmed, source, vectorId } });
}

export async function updateMemory(userId: string, memoryId: string, memory: string) {
  const existing = await db.userMemory.findUnique({ where: { id: memoryId } });
  if (!existing || existing.userId !== userId) throw new Error("Memory not found");

  const trimmed = memory.trim();
  // Re-embed under a fresh point id rather than reusing the old one —
  // simpler than patching a vector in place, and cheap at this volume.
  if (existing.vectorId) await deleteMemoryVector(existing.vectorId).catch(() => undefined);
  const vectorId = await embedAndUpsert(userId, trimmed, existing.source);

  return db.userMemory.update({ where: { id: memoryId }, data: { memory: trimmed, vectorId } });
}

export async function deleteMemory(userId: string, memoryId: string) {
  const existing = await db.userMemory.findUnique({ where: { id: memoryId } });
  if (!existing || existing.userId !== userId) throw new Error("Memory not found");
  await db.userMemory.delete({ where: { id: memoryId } });
  if (existing.vectorId) await deleteMemoryVector(existing.vectorId).catch(() => undefined);
}

/** Memories formatted for injection into a chat system prompt, ranked by
 *  relevance to `queryText` (the current user turn) when provided —
 *  falling back to a recency window if it's omitted, embedding fails, or
 *  Qdrant returns nothing (e.g. a fresh account with no vectors yet).
 *  Returns "" when the user has no memories, so callers can splice it in
 *  unconditionally without an extra branch. */
export async function getMemoryContext(userId: string, queryText?: string): Promise<string> {
  if (queryText?.trim()) {
    try {
      const vector = await embedQuery(queryText);
      const hits = await searchMemories(userId, vector, CHAT_CONTEXT_LIMIT);
      if (hits.length) {
        return hits.map((h) => `- ${h.payload.memory}`).join("\n");
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[memory] Semantic search failed, falling back to recency:", err);
    }
  }

  const memories: { memory: string }[] = await db.userMemory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: CHAT_CONTEXT_LIMIT,
    select: { memory: true },
  });
  if (!memories.length) return "";
  return memories.map((m: { memory: string }) => `- ${m.memory}`).join("\n");
}

const EXTRACTION_SYSTEM_PROMPT = `You extract durable, worth-remembering facts about a user from a chat transcript with an AI research-notebook assistant — things like their stated goals, preferences, background, or recurring interests that would be useful context in a *future, unrelated* conversation.

Rules:
- Only extract genuinely durable facts (e.g. "is studying for the MCAT", "prefers concise answers", "works in renewable energy policy") — never one-off question content or anything already obvious from a single message.
- Do not extract anything sensitive (health details beyond stated study/work context, financial info, etc.) unless the user clearly volunteered it as identity/context, not as a question to answer.
- Return at most 5 short, third-person facts (e.g. "Is preparing for a graduate thesis on coral bleaching").
- If nothing durable is worth remembering, return an empty list.
- Respond with ONLY a JSON object: { "facts": string[] }. No prose, no markdown fences.`;

/** Extracts durable facts from a batch of recent chat messages and stores
 *  them as LEARNED memories. Best-effort: failures are swallowed so a
 *  flaky extraction call never breaks the chat flow that triggered it. */
export async function extractMemoriesFromMessages(
  userId: string,
  messages: { role: "user" | "assistant"; content: string }[]
) {
  if (messages.length === 0) return;
  try {
    const transcript = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n").slice(0, 8000);
    const res = await withRetry(() =>
      openai.chat.completions.create({
        model: CHAT_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: transcript },
        ],
      })
    );
    const raw = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { facts?: string[] };
    const facts = (parsed.facts ?? []).filter((f) => typeof f === "string" && f.trim().length > 0).slice(0, 5);

    // Skip near-duplicates of what's already stored rather than growing the
    // table with the same fact reworded every conversation.
    const existing = await db.userMemory.findMany({ where: { userId }, select: { memory: true } });
    const existingLower = new Set(existing.map((m: { memory: string }) => m.memory.trim().toLowerCase()));

    for (const fact of facts) {
      if (existingLower.has(fact.trim().toLowerCase())) continue;
      await createMemory(userId, fact, "LEARNED");
    }
  } catch {
    // Best-effort — never let memory extraction fail the caller.
  }
}
