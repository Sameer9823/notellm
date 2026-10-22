import { db } from "@/lib/db";
import { setRoadmapProgress } from "@/lib/redis";
import { retrieveVectors } from "@/lib/qdrant";
import { kmeans, pickClusterCount } from "@/lib/clustering";
import { labelClusters } from "@/lib/openai";
import { describeError } from "@/lib/utils";

export const MIN_VIDEOS_FOR_ROADMAP = 2;

type ChunkRow = {
  id: string;
  sourceId: string;
  content: string;
  startSec: number | null;
  index: number;
};
type SourceRow = { id: string; title: string; durationSec: number | null; originUrl: string | null; metadata: unknown };

export type RoadmapNode = {
  id: string; // "cluster-<n>"
  order: number; // final topological position, 0-indexed
  label: string;
  summary: string;
  keywords: string[];
  chunkCount: number;
  videos: { sourceId: string; title: string; originUrl: string | null; timestamps: number[] }[];
};
export type RoadmapEdge = { from: string; to: string };

/**
 * Runs the full "learning roadmap" pipeline for a notebook:
 *  1. Pull chunk embeddings for every READY YouTube source in the notebook
 *     back out of Qdrant (they're already computed at ingest time).
 *  2. Cluster them (k-means, cosine distance) into concept groups.
 *  3. Label each cluster with the LLM from sample excerpts.
 *  4. Build a precedence graph from where each cluster's chunks fall
 *     *within* each video (early vs. late), vote across videos on pairwise
 *     ordering, and topologically sort — i.e. order concepts by how their
 *     keywords/terminology actually progress across the linked videos,
 *     not just by video upload order.
 *  5. Persist nodes + edges to the Roadmap row.
 *
 * Called via Next's `after()`, same pattern as ingest/audio pipelines.
 */
export async function runRoadmapPipeline(roadmapId: string) {
  // Fetch inside the try so a DB failure (or missing row) is recorded as
  // FAILED instead of silently returning and leaving QUEUED forever.
  try {
    const roadmap = await db.roadmap.findUnique({ where: { id: roadmapId } });
    if (!roadmap) return;

    await mark(roadmap.id, "CLUSTERING", "Gathering linked videos", 8);

    const sources = (await db.source.findMany({
      where: { notebookId: roadmap.notebookId, type: "YOUTUBE", status: "READY" },
      select: { id: true, title: true, durationSec: true, originUrl: true, metadata: true },
    })) as SourceRow[];

    if (sources.length < MIN_VIDEOS_FOR_ROADMAP) {
      throw new Error(`Link at least ${MIN_VIDEOS_FOR_ROADMAP} indexed YouTube videos to build a roadmap`);
    }
    const sourceById = new Map(sources.map((s) => [s.id, s]));

    const chunks = (await db.chunk.findMany({
      where: { sourceId: { in: sources.map((s) => s.id) } },
      select: { id: true, sourceId: true, content: true, startSec: true, index: true },
      orderBy: [{ sourceId: "asc" }, { index: "asc" }],
    })) as ChunkRow[];

    if (chunks.length < 6) {
      throw new Error("Not enough indexed transcript content across these videos to build a roadmap yet");
    }

    await mark(roadmap.id, "CLUSTERING", "Loading chunk embeddings", 18);
    const vectorMap = await retrieveVectors(chunks.map((c) => c.id));
    const usable = chunks.filter((c) => vectorMap.has(c.id));
    if (usable.length < 6) {
      throw new Error("Couldn't retrieve enough embeddings for these videos — try reindexing them");
    }
    const vectors = usable.map((c) => vectorMap.get(c.id)!);

    await mark(roadmap.id, "CLUSTERING", "Clustering concepts", 30);
    const k = pickClusterCount(usable.length);
    const { assignments } = kmeans(vectors, k);

    const clusterOf = new Map<number, ChunkRow[]>();
    usable.forEach((chunk, i) => {
      const cid = assignments[i];
      if (!clusterOf.has(cid)) clusterOf.set(cid, []);
      clusterOf.get(cid)!.push(chunk);
    });
    // Drop clusters that are too thin to be a meaningful concept node.
    for (const [cid, group] of clusterOf) {
      if (group.length < 2) clusterOf.delete(cid);
    }
    if (clusterOf.size < 2) {
      throw new Error("Content across these videos was too uniform to split into distinct concepts");
    }

    await mark(roadmap.id, "LABELING", "Naming concepts with the LLM", 50);
    const clusterInputs = [...clusterOf.entries()].map(([clusterId, group]) => ({
      clusterId,
      samples: sampleDiverse(group).map((c) => ({
        video: sourceById.get(c.sourceId)?.title ?? "video",
        text: c.content,
      })),
    }));
    const labels = await labelClusters(clusterInputs);
    const labelById = new Map(labels.map((l) => [l.clusterId, l]));

    await mark(roadmap.id, "ORDERING", "Ordering by concept progression", 75);
    const clusterIds = [...clusterOf.keys()].filter((cid) => labelById.has(cid));
    const nodeKey = (cid: number) => `cluster-${cid}`;

    // Per-video normalized position (0..1) of each cluster, used both as
    // the vote signal for pairwise precedence and as the tie-break/fallback
    // ordering when the vote graph has no clear signal or cycles.
    const avgPosition = new Map<number, number>();
    const positionsByVideoAndCluster = new Map<string, Map<number, number>>(); // sourceId -> clusterId -> avg normalized pos

    for (const cid of clusterIds) {
      const group = clusterOf.get(cid)!;
      const positions = group.map((c) => normalizedPosition(c, sourceById));
      avgPosition.set(cid, positions.reduce((a, b) => a + b, 0) / positions.length);

      const bySource = new Map<string, number[]>();
      for (const c of group) {
        if (!bySource.has(c.sourceId)) bySource.set(c.sourceId, []);
        bySource.get(c.sourceId)!.push(normalizedPosition(c, sourceById));
      }
      for (const [sourceId, pos] of bySource) {
        if (!positionsByVideoAndCluster.has(sourceId)) positionsByVideoAndCluster.set(sourceId, new Map());
        positionsByVideoAndCluster.get(sourceId)!.set(cid, pos.reduce((a, b) => a + b, 0) / pos.length);
      }
    }

    // Vote on pairwise precedence: for every video that contains both
    // clusters, whichever appears earlier gets a vote for "precedes".
    const votes = new Map<string, number>(); // "a>b" -> vote count for a before b
    for (const [, clusterPositions] of positionsByVideoAndCluster) {
      const present = [...clusterPositions.entries()];
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          const [a, posA] = present[i];
          const [b, posB] = present[j];
          const winner = posA <= posB ? `${a}>${b}` : `${b}>${a}`;
          votes.set(winner, (votes.get(winner) ?? 0) + 1);
        }
      }
    }

    const edges: RoadmapEdge[] = [];
    for (let i = 0; i < clusterIds.length; i++) {
      for (let j = i + 1; j < clusterIds.length; j++) {
        const a = clusterIds[i];
        const b = clusterIds[j];
        const aBeforeB = votes.get(`${a}>${b}`) ?? 0;
        const bBeforeA = votes.get(`${b}>${a}`) ?? 0;
        if (aBeforeB === 0 && bBeforeA === 0) continue; // never co-occur in a video — no signal
        if (aBeforeB > bBeforeA) edges.push({ from: nodeKey(a), to: nodeKey(b) });
        else if (bBeforeA > aBeforeB) edges.push({ from: nodeKey(b), to: nodeKey(a) });
        // ties contribute no edge; avgPosition tie-break handles ordering
      }
    }

    const order = topoSort(
      clusterIds.map(nodeKey),
      edges.map((e) => [e.from, e.to] as [string, string]),
      (key) => avgPosition.get(Number(key.replace("cluster-", ""))) ?? 1
    );

    const nodes: RoadmapNode[] = order.map((key, i) => {
      const cid = Number(key.replace("cluster-", ""));
      const group = clusterOf.get(cid)!;
      const label = labelById.get(cid)!;
      const videoMap = new Map<string, number[]>();
      for (const c of group) {
        if (!videoMap.has(c.sourceId)) videoMap.set(c.sourceId, []);
        if (c.startSec != null) videoMap.get(c.sourceId)!.push(c.startSec);
      }
      return {
        id: key,
        order: i,
        label: label.label,
        summary: label.summary,
        keywords: label.keywords ?? [],
        chunkCount: group.length,
        videos: [...videoMap.entries()].map(([sourceId, timestamps]) => ({
          sourceId,
          title: sourceById.get(sourceId)?.title ?? "video",
          originUrl: sourceById.get(sourceId)?.originUrl ?? null,
          timestamps: timestamps.sort((a, b) => a - b),
        })),
      };
    });

    await mark(roadmap.id, "ORDERING", "Finalizing roadmap", 95);
    await db.roadmap.update({
      where: { id: roadmap.id },
      data: {
        status: "READY",
        nodes: nodes as unknown as object,
        edges: edges as unknown as object,
        sourceCount: sources.length,
        errorMessage: null,
      },
    });
    await setRoadmapProgress(roadmap.id, { status: "READY", percent: 100, updatedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Roadmap generation failed";
    // `roadmap` is scoped to the try block above; re-fetch by the param id so
    // a DB error during the original lookup doesn't skip recording the failure.
    const roadmap = await db.roadmap.findUnique({ where: { id: roadmapId } }).catch(() => null);
    if (roadmap) {
      // eslint-disable-next-line no-console
      console.error(`[roadmap] ${roadmap.id} (notebook ${roadmap.notebookId}) failed:`, describeError(err));
      await db.roadmap
        .update({ where: { id: roadmap.id }, data: { status: "FAILED", errorMessage: message } })
        .catch(() => {});
      await setRoadmapProgress(roadmap.id, {
        status: "FAILED",
        errorMessage: message,
        updatedAt: Date.now(),
      }).catch(() => {});
    } else {
      // eslint-disable-next-line no-console
      console.error(`[roadmap] roadmap ${roadmapId} not found during failure recovery:`, describeError(err));
    }
  }
}

async function mark(
  roadmapId: string,
  status: "CLUSTERING" | "LABELING" | "ORDERING",
  step: string,
  percent: number
) {
  await db.roadmap.update({ where: { id: roadmapId }, data: { status } });
  await setRoadmapProgress(roadmapId, { status, step, percent, updatedAt: Date.now() });
}

function normalizedPosition(chunk: ChunkRow, sourceById: Map<string, SourceRow>): number {
  const duration = sourceById.get(chunk.sourceId)?.durationSec;
  if (chunk.startSec == null || !duration || duration <= 0) return 0.5; // unknown -> neutral, no strong vote
  return Math.min(1, Math.max(0, chunk.startSec / duration));
}

/** Picks up to 5 chunks spread across the cluster (and across different
 *  source videos where possible) to keep the LLM labeling prompt small
 *  while still representative. */
function sampleDiverse(group: ChunkRow[]): ChunkRow[] {
  if (group.length <= 5) return group;
  const byVideo = new Map<string, ChunkRow[]>();
  for (const c of group) {
    if (!byVideo.has(c.sourceId)) byVideo.set(c.sourceId, []);
    byVideo.get(c.sourceId)!.push(c);
  }
  const videos = [...byVideo.keys()];
  const picked: ChunkRow[] = [];
  let vi = 0;
  while (picked.length < 5 && picked.length < group.length) {
    const video = videos[vi % videos.length];
    const bucket = byVideo.get(video)!;
    if (bucket.length) picked.push(bucket.shift()!);
    vi++;
    if (videos.every((v) => !byVideo.get(v)!.length)) break;
  }
  return picked;
}

/** Kahn's algorithm with a tie-break key for ready nodes, and a fallback
 *  that breaks any remaining cycle by picking the lowest tie-break node —
 *  cross-video pairwise votes aren't guaranteed transitive, so cycles are
 *  possible on noisy real-world transcripts. */
function topoSort(nodeIds: string[], edges: [string, string][], tiebreak: (id: string) => number): string[] {
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const adj = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const [a, b] of edges) {
    adj.get(a)?.push(b);
    indegree.set(b, (indegree.get(b) ?? 0) + 1);
  }

  const remaining = new Set(nodeIds);
  const order: string[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter((id) => (indegree.get(id) ?? 0) === 0);
    const pool = ready.length ? ready : [...remaining]; // cycle fallback
    pool.sort((a, b) => tiebreak(a) - tiebreak(b));
    const next = pool[0];
    order.push(next);
    remaining.delete(next);
    for (const nb of adj.get(next) ?? []) {
      if (remaining.has(nb)) indegree.set(nb, (indegree.get(nb) ?? 0) - 1);
    }
  }
  return order;
}