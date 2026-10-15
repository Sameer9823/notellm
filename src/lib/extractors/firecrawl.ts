import type { UrlExtractResult } from "./url";
import { serverEnv } from "@/lib/env";

/**
 * Firecrawl (https://firecrawl.dev) scrape API — renders JS, dodges most
 * bot-detection/Cloudflare challenges, and returns clean markdown/text
 * instead of raw HTML. Used as the *primary* URL extraction path when
 * FIRECRAWL_API_KEY is set; `extractUrl` in ./url.ts falls back to the
 * plain fetch + Readability path (or surfaces this error) when it isn't
 * configured or when a scrape fails.
 *
 * Kept dependency-free (raw fetch against the REST API) rather than
 * pulling in `@mendable/firecrawl-js`, matching the rest of this codebase's
 * preference for thin fetch wrappers over source-specific SDKs.
 */

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v1/scrape";

type FirecrawlResponse = {
  success: boolean;
  data?: {
    markdown?: string;
    content?: string;
    metadata?: {
      title?: string;
      ogSiteName?: string;
      author?: string;
      sourceURL?: string;
      statusCode?: number;
      error?: string;
    };
  };
  error?: string;
};

export function firecrawlEnabled(): boolean {
  return serverEnv.firecrawl.enabled;
}

export async function extractUrlWithFirecrawl(url: string): Promise<UrlExtractResult | null> {
  const apiKey = serverEnv.firecrawl.apiKey;
  if (!apiKey) return null;

  let res: Response;
  try {
    res = await fetch(FIRECRAWL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 25000,
      }),
      // Firecrawl itself can take a while on JS-heavy pages — give it room
      // beyond its own internal timeout above.
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Firecrawl request failed — ${cause}`);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`Firecrawl returned ${res.status}${body?.error ? ` — ${body.error}` : ""}`);
  }

  const json = (await res.json()) as FirecrawlResponse;
  if (!json.success || !json.data) {
    throw new Error(json.error || "Firecrawl couldn't scrape this page");
  }

  const text = (json.data.markdown || json.data.content || "").trim();
  if (!text) {
    throw new Error("Firecrawl returned no readable content for this page");
  }

  return {
    title: json.data.metadata?.title?.trim() || url,
    text,
    siteName: json.data.metadata?.ogSiteName ?? undefined,
    byline: json.data.metadata?.author ?? undefined,
  };
}
