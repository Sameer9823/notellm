import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { safeFetch, validateAndResolveUrl } from "@/lib/ssrf";
import { parseEmbedHeaders } from "@/lib/embed-check";
import { extractUrl } from "@/lib/extractors/url";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";
import { createHash } from "node:crypto";

const READER_TEXT_LIMIT = 20_000;
const CACHE_TTL = 10 * 60; // 10 minutes

// In-memory cache fallback (used when Redis is unavailable)
const memoryCache = new Map<string, { result: unknown; expiresAt: number }>();

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
};

function cacheKey(finalUrl: string): string {
  return `webpreview:${createHash("sha1").update(finalUrl).digest("hex")}`;
}

/**
 * Gets a cached web-preview result. Returns null if not cached or expired.
 * Tries Redis first, falls back to in-memory cache.
 */
async function getCachedPreview(finalUrl: string): Promise<any | null> {
  const key = cacheKey(finalUrl);
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {
    // Fall through to in-memory cache
  }
  // In-memory fallback
  const memEntry = memoryCache.get(key);
  if (memEntry && memEntry.expiresAt > Date.now()) {
    return memEntry.result;
  } else if (memEntry) {
    memoryCache.delete(key);
  }
  return null;
}

/**
 * Caches a web-preview result in both Redis and in-memory.
 */
async function setCachedPreview(finalUrl: string, result: unknown) {
  const key = cacheKey(finalUrl);
  try {
    await redis.set(key, JSON.stringify(result), "EX", CACHE_TTL);
  } catch {
    // Fall back to in-memory only
  }
  memoryCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL * 1000 });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url query param is required" }, { status: 400 });
  }

  // Check for bypass-cache query parameter (used by retry)
  const bypassCache = req.nextUrl.searchParams.get("bypass") === "true";

  // SSRF-protect the URL before doing anything with it — http(s) only,
  // private-IP rejection, hostname metadata checks.
  const validation = await validateAndResolveUrl(url);
  if (!validation.ok) {
    return NextResponse.json({ embeddable: "unknown", finalUrl: url, error: validation.error });
  }

  // Rate-limit per user — each preview is an outbound fetch, so cap how
  // often a single user can hammer this endpoint.
  const rl = await checkRateLimit(`ratelimit:webpreview:${userId}`, RATE_LIMITS.webPreview.limit, RATE_LIMITS.webPreview.windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  // HEAD first — we only need headers for the embeddability check, and many
  // sites happily serve headers via HEAD without sending the body. Falls back
  // to GET (aborted after headers) when HEAD isn't supported.
  let res: Response;
  try {
    try {
      res = await safeFetch(url, { method: "HEAD", headers: BROWSER_HEADERS });
    } catch {
      // HEAD failed — fall back to a GET we abort after reading headers.
      const controller = new AbortController();
      res = await safeFetch(url, { method: "GET", headers: BROWSER_HEADERS, signal: controller.signal });
      // We have the headers; cancel the body download.
      controller.abort();
      // Touch the body to be a good citizen, but ignore the content — we
      // only needed the headers. The actual page text comes from extractUrl.
      res.body?.cancel().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Check cache for a previously cached result
    if (!bypassCache) {
      const cached = await getCachedPreview(url);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    // Fail open — return "unknown" so the client tries the iframe anyway
    const result = { embeddable: "unknown" as const, finalUrl: url, error: msg };
    await setCachedPreview(url, result);
    return NextResponse.json(result);
  }

  // Only 2xx responses are considered for embedding — a 4xx/5xx might be a
  // block page with permissive headers, not the real content.
  if (!res.ok) {
    // Check cache for a previously cached result
    if (!bypassCache) {
      const cached = await getCachedPreview(url);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    // Fail open — return "unknown" so the client tries the iframe anyway
    const result = { embeddable: "unknown" as const, finalUrl: res.url || url, error: `Upstream returned ${res.status}` };
    await setCachedPreview(url, result);
    return NextResponse.json(result);
  }

  const { embeddable, reason } = parseEmbedHeaders(res.headers);
  const finalUrl = res.url || url;

  // Check cache before doing expensive reader extraction
  if (!bypassCache) {
    const cached = await getCachedPreview(finalUrl);
    if (cached) {
      return NextResponse.json(cached);
    }
  }

  if (embeddable) {
    const result = { embeddable: true as const, finalUrl };
    await setCachedPreview(finalUrl, result);
    return NextResponse.json(result);
  }

  // Not embeddable — fetch reader content via Readability / Firecrawl so the
  // Studio panel can show an extracted-text reader view instead of an iframe.
  let reader: { title: string; text: string } | null = null;
  try {
    reader = await extractUrl(finalUrl);
  } catch {
    // Reader extraction is best-effort; the Studio panel falls back to
    // whatever it already has (stored chunks or the snippet).
  }

  const result = {
    embeddable: false as const,
    finalUrl,
    reason,
    title: reader?.title,
    text: reader?.text?.slice(0, READER_TEXT_LIMIT),
  };
  await setCachedPreview(finalUrl, result);
  return NextResponse.json(result);
}
