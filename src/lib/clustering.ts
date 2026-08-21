/**
 * Minimal k-means implementation over embedding vectors. Kept dependency-free
 * (no ml-kmeans/etc.) since we only need this for one feature: clustering a
 * notebook's YouTube chunk embeddings into concept groups for the learning
 * roadmap. Uses cosine distance (embeddings are OpenAI `text-embedding-3-*`,
 * which are meant to be compared this way) and k-means++ seeding for
 * stability on small k.
 */

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a)) || 1e-9;
}

export function cosineSim(a: number[], b: number[]): number {
  return dot(a, b) / (norm(a) * norm(b));
}

function cosineDist(a: number[], b: number[]): number {
  return 1 - cosineSim(a, b);
}

function mean(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i];
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

function kmeansPlusPlusSeed(points: number[][], k: number, rng: () => number): number[][] {
  const centroids: number[][] = [points[Math.floor(rng() * points.length)]];
  while (centroids.length < k) {
    const distances = points.map((p) => Math.min(...centroids.map((c) => cosineDist(p, c) ** 2)));
    const total = distances.reduce((a, b) => a + b, 0);
    if (total === 0) {
      centroids.push(points[Math.floor(rng() * points.length)]);
      continue;
    }
    let r = rng() * total;
    let chosen = points[points.length - 1];
    for (let i = 0; i < points.length; i++) {
      r -= distances[i];
      if (r <= 0) {
        chosen = points[i];
        break;
      }
    }
    centroids.push(chosen);
  }
  return centroids;
}

// Simple seeded PRNG (mulberry32) so a given chunk set clusters
// deterministically rather than shuffling on every regenerate.
function seededRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks a reasonable cluster count for a "concept roadmap": enough to be a
 *  useful outline, not so many it stops being skimmable. */
export function pickClusterCount(n: number, { min = 3, max = 9 }: { min?: number; max?: number } = {}): number {
  if (n <= min) return Math.max(1, n);
  return Math.min(max, Math.max(min, Math.round(Math.sqrt(n / 2))));
}

export function kmeans(
  vectors: number[][],
  k: number,
  { maxIterations = 25, seed = 42 }: { maxIterations?: number; seed?: number } = {}
): { assignments: number[]; centroids: number[][] } {
  if (vectors.length === 0) return { assignments: [], centroids: [] };
  const effectiveK = Math.min(k, vectors.length);
  const rng = seededRng(seed);

  let centroids = kmeansPlusPlusSeed(vectors, effectiveK, rng);
  let assignments = new Array(vectors.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    const newAssignments = vectors.map((v) => {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = cosineDist(v, centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      return best;
    });

    for (let i = 0; i < newAssignments.length; i++) {
      if (newAssignments[i] !== assignments[i]) changed = true;
    }
    assignments = newAssignments;

    const groups: number[][][] = Array.from({ length: centroids.length }, () => []);
    vectors.forEach((v, i) => groups[assignments[i]].push(v));
    centroids = groups.map((g, i) => (g.length ? mean(g) : centroids[i]));

    if (!changed && iter > 0) break;
  }

  return { assignments, centroids };
}