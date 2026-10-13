import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;

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
  } catch {
    // Redis is a cache, not the source of truth — swallow and rely on Postgres.
  }
}

export async function getProgress(sourceId: string): Promise<IndexingProgress | null> {
  try {
    const raw = await redis.get(key(sourceId));
    return raw ? (JSON.parse(raw) as IndexingProgress) : null;
  } catch {
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
  } catch {
    // Redis is a cache, not the source of truth — swallow and rely on Postgres.
  }
}

export async function getAudioProgress(audioId: string): Promise<AudioProgress | null> {
  try {
    const raw = await redis.get(audioKey(audioId));
    return raw ? (JSON.parse(raw) as AudioProgress) : null;
  } catch {
    return null;
  }
}

export async function clearAudioProgress(audioId: string) {
  try {
    await redis.del(audioKey(audioId));
  } catch {
    // best-effort cache cleanup
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
  } catch {
    // Redis is a cache, not the source of truth — swallow and rely on Postgres.
  }
}

export async function getRoadmapProgress(roadmapId: string): Promise<RoadmapProgress | null> {
  try {
    const raw = await redis.get(roadmapKey(roadmapId));
    return raw ? (JSON.parse(raw) as RoadmapProgress) : null;
  } catch {
    return null;
  }
}

export async function clearRoadmapProgress(roadmapId: string) {
  try {
    await redis.del(roadmapKey(roadmapId));
  } catch {
    // best-effort cache cleanup
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
  } catch {
    // Redis is a cache, not the source of truth — swallow and rely on Postgres.
  }
}

export async function getArtifactProgress(artifactId: string): Promise<ArtifactProgress | null> {
  try {
    const raw = await redis.get(artifactKey(artifactId));
    return raw ? (JSON.parse(raw) as ArtifactProgress) : null;
  } catch {
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
  } catch {
    return null;
  }
}

export async function setCachedSnapshotUrl(urlHash: string, url: string): Promise<void> {
  try {
    await redis.set(snapshotCacheKey(urlHash), url, "EX", SNAPSHOT_CACHE_TTL);
  } catch {
    // cache miss on subsequent loads — non-fatal
  }
}