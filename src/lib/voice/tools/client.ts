import { defineTool } from "samai-sdk/voice";
import { z } from "zod";
import { getToolToken } from "../tool-token-store";

const searchSchema = z.object({
  query: z.string().min(1).max(300),
});

export const VOICE_TOOLS = [
  defineTool({
    name: "search_notebook",
    description:
      "Search the user's notebook sources for passages relevant to their question. Always call this before answering a factual question about the sources.",
    parameters: searchSchema,
    execute: async (args: { query: string }) => {
      const token = getToolToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["x-voice-tool-token"] = token;

      const res = await fetch(`/api/voice/tools/search_notebook`, {
        method: "POST",
        headers,
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return JSON.stringify({ error: body?.error ?? "The search_notebook tool failed." });
      }
      const data = await res.json();
      return data.result;
    },
  }),
];
