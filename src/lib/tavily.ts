/**
 * Tavily (https://tavily.com) search API — used to power the "Web Search"
 * source tile: the user types a question/topic, we hand back a handful of
 * candidate article URLs (with a snippet each) they can pick from, and the
 * ones they pick get added as normal URL sources and run through the same
 * extractUrl -> chunk -> embed pipeline as every other source.
 *
 * This module only *searches* — it never fetches full page content itself,
 * so results here don't overlap with (and don't replace) Firecrawl, which
 * is what actually extracts each chosen page's content during ingest.
 */

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

export type TavilySearchResult = {
  title: string;
  url: string;
  /** Short snippet Tavily extracted around the matched content. */
  snippet: string;
};

export function tavilyEnabled(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

export async function tavilySearch(query: string, maxResults = 6): Promise<TavilySearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("Web search isn't configured (missing TAVILY_API_KEY)");
  }

  let res: Response;
  try {
    res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: Math.min(Math.max(maxResults, 1), 10),
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Couldn't reach Tavily — ${cause}`);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`Tavily search failed (${res.status})${body?.error ? ` — ${body.error}` : ""}`);
  }

  const json = (await res.json()) as {
    results?: { title?: string; url: string; content?: string }[];
  };

  return (json.results ?? [])
    .filter((r) => Boolean(r.url))
    .map((r) => ({
      title: r.title?.trim() || r.url,
      url: r.url,
      snippet: (r.content ?? "").trim().slice(0, 220),
    }));
}
