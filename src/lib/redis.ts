import Redis, { type RedisOptions } from "ioredis";
import { serverEnv } from "@/lib/env";

// Cache the Redis instance so serverless invocations reuse a single connection
// per instance instead of opening a new socket on every cold start — which
// defeats the singleton and can trigger "Stream isn't writeable" errors.
const globalForRedis = globalThis as unknown as { redis?: Redis };

const redisOptions: RedisOptions = {
  // `maxRetriesPerRequest` is intentionally tiny: a queued command should fail
  // fast rather than hold a serverless invocation open while the client
  // reconnects (Redis is a cache — we fail open to Postgres).
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
  commandTimeout: 3000,
  // Never permanently give up: keep retrying with a capped-backoff so a
  // transient connection blip (e.g. a cold-start TLS handshake delay against
  // a managed provider) doesn't leave the client dead until next restart.
  // ioredis treats a non-null return as "retry after N ms".
  retryStrategy: (times: number) => Math.min(times * 500, 5000),
};

// Some managed Redis providers (e.g. Upstash) only expose the TCP endpoint
// over TLS — passing a plain `redis://` URL won't encrypt the socket, so the
// connection hangs/rejects. The `rediss://` scheme tells ioredis to enable TLS.
if (serverEnv.redis.url.startsWith("rediss://")) {
  redisOptions.tls = {};
}

export const redis =
  globalForRedis.redis ??
  new Redis(serverEnv.redis.url, redisOptions);

// Handle connection errors gracefully to avoid unhandled rejections. Throttled
// to once per 15s so a prolonged outage doesn't flood the logs with one line
// per retry; the warning text also points operators at the rediss:// requirement.
let lastRedisErrorLog = 0;
redis.on("error", (err) => {
  const now = Date.now();
  if (now - lastRedisErrorLog < 15_000) return;
  lastRedisErrorLog = now;
  // eslint-disable-next-line no-console
  console.warn(
    `[redis] connection error: ${err.message}. If you use a managed provider ` +
      `(e.g. Upstash) make sure REDIS_URL uses the TCP rediss:// form (TLS), not the REST https:// URL.`
  );
});

// Cache the singleton so serverless invocations reuse a single connection
// per instance instead of opening a new socket on every cold start.
globalForRedis.redis = redis;

/**
 * Lightweight health check used by the /api/dev/inngest-status route.
 * Returns `{ ok, latencyMs, error }` so the diagnostics page can report
 * whether Redis is reachable and how long a round-trip PING takes.
 */
export async function pingRedis(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    await redis.ping();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}


/**
 * Redis is used as a fast, ephemeral status/progress layer so the UI can
 * poll indexing state without round-tripping Postgres on every tick.
 * Postgres remains the source of truth; Redis just mirrors the latest
 * status with a short TTL so it self-heals if a write is ever missed.
 */
export type IndexingProgress = {
  status: "UPLOADING" | "QUEUED" | "INDEXING" | "READY" | "FAILED";
  step?: string; // e.g. "Extracting text", "Chunking", "Embedding 12/40"
  percent?: number;
  errorMessage?: string;
  updatedAt: number;
};

const key = (sourceId: string) => `source:${sourceId}:progress`;

export async function setProgress(sourceId: string, progress: IndexingProgress) {
  try {
    await redis.set(key(sourceId), JSON.stringify(progress), "EX", 60 * 30);
  } catch (err) {
    // Redis is a cache, not the source of truth — swallow and rely on Postgres.
    console.warn("[redis] setProgress failed for source", sourceId, "-", err instanceof Error ? err.message : String(err));
  }
}

export async function getProgress(sourceId: string): Promise<IndexingProgress | null> {
  try {
    const raw = await redis.get(key(sourceId));
    return raw ? (JSON.parse(raw) as IndexingProgress) : null;
  } catch (err) {
    console.warn("[redis] getProgress failed for source", sourceId, "-", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export type AudioProgress = {
  status: "QUEUED" | "SCRIPTING" | "SYNTHESIZING" | "READY" | "FAILED";
  step?: string;
  percent?: number;
  errorMessage?: string;
  updatedAt: number;
};

const audioKey = (audioId: string) => `audio:${audioId}:progress`;

export async function setAudioProgress(audioId: string, progress: AudioProgress) {
  try {
    await redis.set(audioKey(audioId), JSON.stringify(progress), "EX", 60 * 30);
  } catch (err) {
    // Redis is a cache, not the source of truth — swallow and rely on Postgres.
    console.warn("[redis] setAudioProgress failed for", audioId, "-", err instanceof Error ? err.message : String(err));
  }
}

export async function getAudioProgress(audioId: string): Promise<AudioProgress | null> {
  try {
    const raw = await redis.get(audioKey(audioId));
    return raw ? (JSON.parse(raw) as AudioProgress) : null;
  } catch (err) {
    console.warn("[redis] getAudioProgress failed for", audioId, "-", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function clearAudioProgress(audioId: string) {
  try {
    await redis.del(audioKey(audioId));
  } catch (err) {
    // best-effort cache cleanup
    console.warn("[redis] clearAudioProgress failed for", audioId, "-", err instanceof Error ? err.message : String(err));
  }
}

export type RoadmapProgress = {
  status: "QUEUED" | "CLUSTERING" | "LABELING" | "ORDERING" | "READY" | "FAILED";
  step?: string;
  percent?: number;
  errorMessage?: string;
  updatedAt: number;
};

const roadmapKey = (roadmapId: string) => `roadmap:${roadmapId}:progress`;

export async function setRoadmapProgress(roadmapId: string, progress: RoadmapProgress) {
  try {
    await redis.set(roadmapKey(roadmapId), JSON.stringify(progress), "EX", 60 * 30);
  } catch (err) {
    // Redis is a cache, not the source of truth — swallow and rely on Postgres.
    console.warn("[redis] setRoadmapProgress failed for", roadmapId, "-", err instanceof Error ? err.message : String(err));
  }
}

export async function getRoadmapProgress(roadmapId: string): Promise<RoadmapProgress | null> {
  try {
    const raw = await redis.get(roadmapKey(roadmapId));
    return raw ? (JSON.parse(raw) as RoadmapProgress) : null;
  } catch (err) {
    console.warn("[redis] getRoadmapProgress failed for", roadmapId, "-", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function clearRoadmapProgress(roadmapId: string) {
  try {
    await redis.del(roadmapKey(roadmapId));
  } catch (err) {
    // best-effort cache cleanup
    console.warn("[redis] clearRoadmapProgress failed for", roadmapId, "-", err instanceof Error ? err.message : String(err));
  }
}

export type ArtifactProgress = {
  status: "QUEUED" | "GENERATING" | "READY" | "FAILED";
  step?: string;
  percent?: number;
  errorMessage?: string;
  updatedAt: number;
};

const artifactKey = (artifactId: string) => `artifact:${artifactId}:progress`;

export async function setArtifactProgress(artifactId: string, progress: ArtifactProgress) {
  try {
    await redis.set(artifactKey(artifactId), JSON.stringify(progress), "EX", 60 * 30);
  } catch (err) {
    // Redis is a cache, not the source of truth — swallow and rely on Postgres.
    console.warn("[redis] setArtifactProgress failed for", artifactId, "-", err instanceof Error ? err.message : String(err));
  }
}

export async function getArtifactProgress(artifactId: string): Promise<ArtifactProgress | null> {
  try {
    const raw = await redis.get(artifactKey(artifactId));
    return raw ? (JSON.parse(raw) as ArtifactProgress) : null;
  } catch (err) {
    console.warn("[redis] getArtifactProgress failed for", artifactId, "-", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Ephemeral cache for web-page screenshot URLs (keyed by URL hash).
 *  TTL ~7 days — screenshots are reused across sessions for the same page.
 *  Only used for WEB citations (no Source row to persist to). */
const snapshotCacheKey = (urlHash: string) => `snapshot:${urlHash}`;
const SNAPSHOT_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days

export async function getCachedSnapshotUrl(urlHash: string): Promise<string | null> {
  try {
    return await redis.get(snapshotCacheKey(urlHash));
  } catch (err) {
    console.warn("[redis] getCachedSnapshotUrl failed for", urlHash, "-", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function setCachedSnapshotUrl(urlHash: string, url: string): Promise<void> {
  try {
    await redis.set(snapshotCacheKey(urlHash), url, "EX", SNAPSHOT_CACHE_TTL);
  } catch (err) {
    // cache miss on subsequent loads — non-fatal
    console.warn("[redis] setCachedSnapshotUrl failed for", urlHash, "-", err instanceof Error ? err.message : String(err));
  }
}