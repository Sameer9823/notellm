import { z } from "zod";
import type { ServerTool } from "./types";
import { searchNotebook } from "@/lib/qdrant";
import { embedQuery } from "@/lib/openai";
import { retrieveWeb } from "@/lib/rag";
import { tavilyEnabled } from "@/lib/tavily";

const searchSchema = z.object({
  query: z.string().min(1).max(300).describe("The user's question, as a short natural-language query."),
});

/** Maximum number of citations to surface to the user from a single tool call. */
const MAX_CITATIONS = 4;

export function createSearchNotebookTool(notebookId: string): ServerTool<typeof searchSchema> {
  return {
    name: "search_notebook",
    description:
      "Search the user's notebook sources for passages relevant to their question. Always call this before answering a factual question about the sources.",
    parameters: searchSchema,
    sideEffects: false,
    async execute({ query }) {
      const results = await searchNotebookImpl(notebookId, query);
      if (!results.length) {
        return JSON.stringify({ results: [], note: "no relevant passages" });
      }
      return JSON.stringify({ results: withRefs(results) });
    },
  };
}

/**
 * Live web search (Tavily). Only registered when TAVILY_API_KEY is configured —
 * the client never calls it without a key, but the server check is the source
 * of truth so the route can also guard against a misconfigured deployment.
 */
export function createSearchWebTool(): ServerTool<typeof searchSchema> {
  return {
    name: "search_web",
    description:
      "Search the live web for recent or outside-your-notebook information. Use this when the user's question is about something not covered by their notebook sources, or needs the latest information.",
    parameters: searchSchema,
    sideEffects: false,
    async execute({ query }) {
      const results = await searchWebImpl(query);
      if (!results.length) {
        return JSON.stringify({ results: [], note: "no web results found" });
      }
      return JSON.stringify({ results: withRefs(results) });
    },
  };
}

/** Maps [n] citation markers onto each result so the agent can say
 *  "source 1", "source 2", etc. when referencing a passage — and the
 *  transcript knows which chip to highlight. */
function withRefs(results: Array<{ marker?: number } & Record<string, unknown>>): Array<{ marker?: number } & Record<string, unknown>> {
  return results.map((r, i) => ({ ...r, marker: i + 1 }));
}

async function searchNotebookImpl(
  notebookId: string,
  query: string
): Promise<Array<{ sourceTitle: string; text: string; locationLabel: string; url?: string; chunkId: string; sourceId: string; sourceType: string; page?: number; startSec?: number; startChar?: number; score?: number }>> {
  const vector = await embedQuery(query);
  const hits = await searchNotebook(notebookId, vector, 8);
  const floor = 0.15;
  const seen = new Set<string>();
  const results: Array<{ sourceTitle: string; text: string; locationLabel: string; url?: string; chunkId: string; sourceId: string; sourceType: string; page?: number; startSec?: number; startChar?: number; score?: number }> = [];

  for (const h of hits.filter((h) => h.score >= floor)) {
    const p = h.payload;
    // Dedupe by chunkId — Qdrant occasionally returns duplicate points for
    // near-identical vectors, and we only want one citation per chunk.
    if (seen.has(p.chunkId)) continue;
    seen.add(p.chunkId);
    const locator = p.page != null ? `p. ${p.page}` : p.startSec != null ? `${p.startSec}s` : p.startChar != null ? `char ${p.startChar}` : "";
    results.push({
      sourceTitle: p.sourceTitle,
      text: p.content,
      locationLabel: locator,
      url: p.sourceType === "URL" || p.sourceType === "YOUTUBE" ? p.originUrl : undefined,
      page: p.page ?? undefined,
      startSec: p.startSec ?? undefined,
      startChar: p.startChar ?? undefined,
      chunkId: p.chunkId,
      sourceId: p.sourceId,
      sourceType: p.sourceType,
      score: h.score,
    });
    // Prefer showing only the sources the agent actually referenced — cap
    // the number of candidates so the transcript doesn't get flooded with
    // chips for every retrieved chunk.
    if (results.length >= MAX_CITATIONS) break;
  }

  return results;
}

async function searchWebImpl(query: string): Promise<Array<{ sourceTitle: string; text: string; locationLabel: string; url?: string; chunkId: string; sourceId: string; sourceType: string; page?: number; startSec?: number; startChar?: number; score?: number }>> {
  const webChunks = await retrieveWeb(query, MAX_CITATIONS);
  // Dedupe by URL — Tavily can return the same article from different result
  // positions, and we only want one citation per unique page.
  const seen = new Set<string>();
  const results = webChunks
    .filter((c) => {
      if (seen.has(c.url ?? "")) return false;
      seen.add(c.url ?? "");
      return true;
    })
    .slice(0, MAX_CITATIONS)
    .map((c) => ({
      sourceTitle: c.sourceTitle,
      text: c.content,
      locationLabel: "web",
      url: c.url,
      chunkId: c.chunkId,
      sourceId: c.sourceId,
      sourceType: c.sourceType,
    }));

  return results;
}

export const TOOLS = ["search_notebook", "search_web"] as const;
export const TOOL_NAMES = TOOLS.map((t) => t) as ReadonlyArray<string>;
export type ToolName = (typeof TOOLS)[number];

// Re-export so the API route can check availability.
export { tavilyEnabled };

/** Returns the set of server-side tools available right now. `search_web` is
 *  only included when Tavily is configured. */
export function getAvailableTools(): ToolName[] {
  return tavilyEnabled() ? [...TOOLS] : ["search_notebook"];
}

export function createToolByName(name: string, notebookId: string): ServerTool | null {
  if (name === "search_notebook") return createSearchNotebookTool(notebookId);
  if (name === "search_web") return createSearchWebTool();
  return null;
}
