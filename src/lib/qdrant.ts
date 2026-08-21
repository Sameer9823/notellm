import { QdrantClient } from "@qdrant/js-client-rest";

export const COLLECTION = process.env.QDRANT_COLLECTION || "notebook_chunks";
const EMBEDDING_DIM = 1536; // text-embedding-3-small

const globalForQdrant = globalThis as unknown as { qdrant?: QdrantClient };

export const qdrant =
  globalForQdrant.qdrant ??
  new QdrantClient({
    url: process.env.QDRANT_URL as string,
    apiKey: process.env.QDRANT_API_KEY,
  });

if (process.env.NODE_ENV !== "production") globalForQdrant.qdrant = qdrant;

let ensured = false;

/** Idempotently ensures the shared collection exists, with payload indexes
 *  for the fields we filter on (notebook isolation + source scoping). */
export async function ensureCollection() {
  if (ensured) return;
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION);

  if (!exists) {
    await qdrant.createCollection(COLLECTION, {
      vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
      optimizers_config: { default_segment_number: 2 },
    });
    await qdrant.createPayloadIndex(COLLECTION, { field_name: "notebookId", field_schema: "keyword" });
    await qdrant.createPayloadIndex(COLLECTION, { field_name: "sourceId", field_schema: "keyword" });
  }
  ensured = true;
}

export type ChunkPayload = {
  notebookId: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: string;
  chunkId: string;
  index: number;
  content: string;
  page?: number;
  startSec?: number;
  endSec?: number;
  startChar?: number;
  endChar?: number;
};

export async function upsertChunks(points: { id: string; vector: number[]; payload: ChunkPayload }[]) {
  await ensureCollection();
  await qdrant.upsert(COLLECTION, { wait: true, points });
}

/** Patches the `sourceTitle` payload field on every chunk belonging to a
 *  source in place (no re-embedding needed) — used when a source is
 *  renamed so future citations/search results show the new title instead
 *  of the one baked in at ingest time. */
export async function updateSourceTitle(sourceId: string, title: string) {
  await ensureCollection();
  await qdrant.setPayload(COLLECTION, {
    wait: true,
    payload: { sourceTitle: title },
    filter: { must: [{ key: "sourceId", match: { value: sourceId } }] },
  });
}

export async function deleteBySource(sourceId: string) {
  await ensureCollection();
  await qdrant.delete(COLLECTION, {
    wait: true,
    filter: { must: [{ key: "sourceId", match: { value: sourceId } }] },
  });
}

export async function searchNotebook(notebookId: string, vector: number[], limit = 8, sourceId?: string | null) {
  await ensureCollection();
  const must: Record<string, unknown>[] = [{ key: "notebookId", match: { value: notebookId } }];
  if (sourceId) must.push({ key: "sourceId", match: { value: sourceId } });
  const res = await qdrant.search(COLLECTION, {
    vector,
    limit,
    filter: { must },
    with_payload: true,
  });
  return res as unknown as { id: string; score: number; payload: ChunkPayload }[];
}

/** Retrieves the already-computed embedding vectors for a specific set of
 *  point ids (== chunk ids). Used by the roadmap pipeline to cluster chunk
 *  embeddings across a set of linked videos without re-embedding anything. */
export async function retrieveVectors(ids: string[]): Promise<Map<string, number[]>> {
  await ensureCollection();
  const out = new Map<string, number[]>();
  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const points = await qdrant.retrieve(COLLECTION, { ids: batch, with_vector: true, with_payload: false });
    for (const p of points) {
      if (Array.isArray(p.vector)) out.set(String(p.id), p.vector as number[]);
    }
  }
  return out;
}

// --- User memory collection ---
// Kept as a separate Qdrant collection from `notebook_chunks` above: the
// payload shape is completely different (a user-scoped fact, not a
// notebook-scoped source chunk), and isolating it means memory retrieval
// never has to filter past millions of RAG chunk vectors, or risk a
// notebookId/userId filter mismatch leaking one user's chunks into
// another's memory context (or vice versa).
export const MEMORY_COLLECTION = process.env.QDRANT_MEMORY_COLLECTION || "user_memories";
let memoryCollectionEnsured = false;

async function ensureMemoryCollection() {
  if (memoryCollectionEnsured) return;
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === MEMORY_COLLECTION);
  if (!exists) {
    await qdrant.createCollection(MEMORY_COLLECTION, {
      vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
      optimizers_config: { default_segment_number: 1 }, // small collection — no need for multiple segments
    });
    await qdrant.createPayloadIndex(MEMORY_COLLECTION, { field_name: "userId", field_schema: "keyword" });
  }
  memoryCollectionEnsured = true;
}

export type MemoryPayload = { userId: string; memory: string; source: "MANUAL" | "LEARNED" };

export async function upsertMemoryVector(id: string, vector: number[], payload: MemoryPayload) {
  await ensureMemoryCollection();
  await qdrant.upsert(MEMORY_COLLECTION, { wait: true, points: [{ id, vector, payload }] });
}

export async function deleteMemoryVector(id: string) {
  await ensureMemoryCollection();
  await qdrant.delete(MEMORY_COLLECTION, { wait: true, points: [id] });
}

/** Semantic search over a single user's memories, seeded by the current
 *  chat turn's embedding — replaces a flat recency window so older-but-
 *  relevant facts don't fall out of context once a user has many memories. */
export async function searchMemories(userId: string, vector: number[], limit = 8) {
  await ensureMemoryCollection();
  const res = await qdrant.search(MEMORY_COLLECTION, {
    vector,
    limit,
    filter: { must: [{ key: "userId", match: { value: userId } }] },
    with_payload: true,
  });
  return res as unknown as { id: string; score: number; payload: MemoryPayload }[];
}