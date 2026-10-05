import { z } from "zod";
import type { ServerTool } from "./types";
import { searchNotebook } from "@/lib/qdrant";
import { embedQuery } from "@/lib/openai";

const searchSchema = z.object({
  query: z.string().min(1).max(300).describe("The user's question, as a short natural-language query."),
});

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
      return JSON.stringify({ results });
    },
  };
}

async function searchNotebookImpl(notebookId: string, query: string): Promise<
  Array<{
    sourceTitle: string;
    text: string;
    locationLabel: string;
    page?: number;
    startSec?: number;
    startChar?: number;
    chunkId: string;
    sourceId: string;
    sourceType: string;
  }>
> {
  const vector = await embedQuery(query);
  const hits = await searchNotebook(notebookId, vector, 5);
  const floor = 0.15;
  return hits
    .filter((h) => h.score >= floor)
    .map((h) => {
      const p = h.payload;
      const locator = p.page != null ? `p. ${p.page}` : p.startSec != null ? `${p.startSec}s` : p.startChar != null ? `char ${p.startChar}` : "";
      return {
        sourceTitle: p.sourceTitle,
        text: p.content,
        locationLabel: locator,
        page: p.page ?? undefined,
        startSec: p.startSec ?? undefined,
        startChar: p.startChar ?? undefined,
        chunkId: p.chunkId,
        sourceId: p.sourceId,
        sourceType: p.sourceType,
      };
    });
}

export const TOOLS = ["search_notebook"] as const;
export const TOOL_NAMES = TOOLS.map((t) => t) as ReadonlyArray<string>;
export type ToolName = (typeof TOOLS)[number];
