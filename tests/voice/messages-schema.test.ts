import { describe, it, expect } from "vitest";
import { z } from "zod";

const saveSchema = z.object({
  role: z.enum(["USER", "ASSISTANT"]),
  content: z.string().min(1).max(5000),
  citations: z.array(
    z.object({
      marker: z.number(),
      chunkId: z.string(),
      sourceId: z.string(),
      sourceTitle: z.string(),
      sourceType: z.string(),
      page: z.number().nullable().optional(),
      startSec: z.number().nullable().optional(),
      endSec: z.number().nullable().optional(),
      snippet: z.string(),
      url: z.string().url().nullable().optional(),
    })
  ).optional().nullable(),
});

describe("voice messages schema", () => {
  it("validates citations schema", () => {
    const good = {
      role: "ASSISTANT",
      content: "Based on page 12, the answer is 42.",
      citations: [
        {
          marker: 1,
          chunkId: "chunk_1",
          sourceId: "src_1",
          sourceTitle: "Doc",
          sourceType: "PDF",
          page: 12,
          startSec: null,
          endSec: null,
          snippet: "the answer is 42",
          url: null,
        },
      ],
    };
    expect(saveSchema.safeParse(good).success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const bad = { role: "USER", content: "" };
    expect(saveSchema.safeParse(bad).success).toBe(false);
  });

  it("validates WEB citation with url", () => {
    const good = {
      role: "ASSISTANT",
      content: "The capital of France is Paris.",
      citations: [
        {
          marker: 1,
          chunkId: "web:https://example.com:0",
          sourceId: "web:https://example.com",
          sourceTitle: "France Capital",
          sourceType: "WEB",
          snippet: "The capital of France is Paris.",
          url: "https://example.com",
        },
      ],
    };
    expect(saveSchema.safeParse(good).success).toBe(true);
  });

  it("validates URL citation with originUrl as url", () => {
    const good = {
      role: "ASSISTANT",
      content: "According to the article...",
      citations: [
        {
          marker: 1,
          chunkId: "chunk_2",
          sourceId: "src_2",
          sourceTitle: "Article Title",
          sourceType: "URL",
          snippet: "key passage from the article",
          url: "https://example.com/article",
        },
      ],
    };
    expect(saveSchema.safeParse(good).success).toBe(true);
  });
});
