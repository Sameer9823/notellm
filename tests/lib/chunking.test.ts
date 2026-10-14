import { describe, it, expect } from "vitest";
import { chunkPlainText } from "../../src/lib/chunking";

const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 450;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;

function makeSentences(n: number, len = 100): string {
  return Array.from({ length: n }, (_, i) => {
    const label = `S${i}`;
    const padding = "x".repeat(len - label.length - 1);
    return `${label}${padding}.`;
  }).join(" ");
}

describe("chunkPlainText", () => {
  it("empty input gives []", () => {
    expect(chunkPlainText("")).toEqual([]);
    expect(chunkPlainText("   ")).toEqual([]);
    expect(chunkPlainText("\n\n\n")).toEqual([]);
  });

  it("18 sentences (~1800 chars) gives exactly 1 chunk", () => {
    const text = makeSentences(18);
    const chunks = chunkPlainText(text);
    expect(chunks).toHaveLength(1);
  });

  it("no chunk range is contained in another", () => {
    for (const n of [5, 18, 19, 25, 40, 77]) {
      const text = makeSentences(n);
      const chunks = chunkPlainText(text);
      for (let i = 0; i < chunks.length; i++) {
        for (let j = 0; j < chunks.length; j++) {
          if (i === j) continue;
          const a = chunks[i];
          const b = chunks[j];
          const contained = a.startChar! >= b.startChar! && a.endChar! <= b.endChar!;
          expect(contained).toBe(false);
        }
      }
    }
  });

  it("first chunk starts at 0 and last ends at text length", () => {
    for (const n of [5, 18, 19, 25, 40, 77]) {
      const text = makeSentences(n);
      const chunks = chunkPlainText(text);
      if (chunks.length === 0) continue;
      expect(chunks[0].startChar).toBe(0);
      // clean text = trimmed input for these sentence-based inputs
      expect(chunks[chunks.length - 1].endChar).toBe(text.trim().length);
    }
  });

  it("consecutive chunks overlap", () => {
    const text = makeSentences(25);
    const chunks = chunkPlainText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i + 1].startChar).toBeLessThan(chunks[i].endChar!);
    }
  });

  it("unpunctuated text gives chunks with tokenCount <= 1000", () => {
    const text = "word ".repeat(10000);
    const chunks = chunkPlainText(text);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(1000);
    }
  });

  it("slice(startChar,endChar).trim() equals content", () => {
    const text = makeSentences(25);
    const chunks = chunkPlainText(text);
    const clean = text.trim();
    for (const chunk of chunks) {
      expect(clean.slice(chunk.startChar!, chunk.endChar!).trim()).toBe(chunk.content);
    }
  });
});
