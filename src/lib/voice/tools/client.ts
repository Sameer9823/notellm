import { defineTool } from "samai-sdk/voice";
import { z } from "zod";
import { getToolToken } from "../tool-token-store";
import { tavilyEnabledPublic } from "@/lib/tavily";

const searchSchema = z.object({
  query: z.string().min(1).max(300),
});

function makeSearchNotebookTool() {
  return defineTool({
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
  });
}

function makeSearchWebTool() {
  return defineTool({
    name: "search_web",
    description:
      "Search the live web for recent or outside-your-notebook information. Use this when the user's question is about something not covered by their notebook sources, or needs the latest information.",
    parameters: searchSchema,
    execute: async (args: { query: string }) => {
      const token = getToolToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["x-voice-tool-token"] = token;

      const res = await fetch(`/api/voice/tools/search_web`, {
        method: "POST",
        headers,
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return JSON.stringify({ error: body?.error ?? "The search_web tool failed." });
      }
      const data = await res.json();
      return data.result;
    },
  });
}

export const VOICE_TOOLS = tavilyEnabledPublic()
  ? [makeSearchNotebookTool(), makeSearchWebTool()]
  : [makeSearchNotebookTool()];
