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
        },
      ],
    };
    expect(saveSchema.safeParse(good).success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const bad = { role: "USER", content: "" };
    expect(saveSchema.safeParse(bad).success).toBe(false);
  });
});
