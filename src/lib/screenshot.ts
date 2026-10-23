import crypto from "crypto";
import { getCachedSnapshotUrl, setCachedSnapshotUrl } from "@/lib/redis";
import { cloudinaryEnabled, uploadBuffer } from "@/lib/cloudinary";
import { serverEnv } from "@/lib/env";

// Firecrawl scrape endpoint — same base as src/lib/extractors/firecrawl.ts.
// Firecrawl's scrape API supports `formats: ["screenshot"]` which returns
// a base64-encoded PNG in `data.screenshot`. See
// https://docs.firecrawl.dev for the current API shape.
const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v1/scrape";

type FirecrawlScreenshotResponse = {
  success: boolean;
  data?: {
    screenshot?: string; // base64-encoded PNG or data URI
  };
  error?: string;
};

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Takes a full-page screenshot of `url` via Firecrawl, uploads it to
 * Cloudinary, and caches the Cloudinary URL by URL hash (7-day TTL) so
 * repeat clicks don't re-screenshot the same page.
 *
 * Returns the Cloudinary URL, or null if screenshotting isn't
 * available (no FIRECRAWL_API_KEY, no Cloudinary, or the scrape fails).
 */
export async function screenshotUrl(url: string): Promise<string | null> {
  const apiKey = serverEnv.firecrawl.apiKey;
  if (!apiKey || !cloudinaryEnabled()) return null;

  // Check Redis cache first (keyed by URL hash).
  const hash = sha256(url);
  const cached = await getCachedSnapshotUrl(hash);
  if (cached) return cached;

  const res = await fetch(FIRECRAWL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["screenshot"],
      fullPage: true,
      timeout: 25000,
    }),
    signal: AbortSignal.timeout(35000),
  });

  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[screenshot] Firecrawl returned ${res.status} for ${url}`);
    return null;
  }

  const json = (await res.json()) as FirecrawlScreenshotResponse;
  if (!json.success || !json.data?.screenshot) {
    // eslint-disable-next-line no-console
    console.warn("[screenshot] Firecrawl didn't return a screenshot:", json.error);
    return null;
  }

  // Firecrawl returns a base64-encoded PNG (data URI or raw base64).
  const b64 = json.data.screenshot.replace(/^data:image\/png;base64,/, "");
  const buffer = Buffer.from(b64, "base64");
  if (!buffer.length) return null;

  let uploaded: { url: string; publicId: string; bytes: number };
  try {
    const publicId = `footnote/snapshots/${hash.slice(0, 12)}`;
    uploaded = await uploadBuffer(buffer, {
      resourceType: "image",
      folder: "footnote/snapshots",
      publicId,
      filename: `${hash.slice(0, 12)}.png`,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[screenshot] Cloudinary upload failed:", err);
    return null;
  }

  // Cache the Cloudinary URL in Redis.
  await setCachedSnapshotUrl(hash, uploaded.url);

  return uploaded.url;
}
