import { describe, it, expect, vi } from "vitest";

vi.mock("pdf-parse", () => ({
  default: vi.fn(),
}));

import { reconstructPageText, normalizePageText } from "../src/lib/extractors/pdf";

type TestItem = {
  str: string;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
  hasEOL?: boolean;
};

const baseHeight = 12; // typical font size in PDF text items

describe("reconstructPageText", () => {
  it("reconstructs split glyph-per-item words with no spaces", () => {
    // Simulates a PDF that emits each character as a separate item with
    // zero horizontal gap — the old join(" ") produced "D a t a".
    const items: TestItem[] = [
      { str: "D", transform: [1, 0, 0, 1, 0, 100], width: 6, height: baseHeight },
      { str: "a", transform: [1, 0, 0, 1, 6, 100], width: 5, height: baseHeight },
      { str: "t", transform: [1, 0, 0, 1, 11, 100], width: 3, height: baseHeight },
      { str: "a", transform: [1, 0, 0, 1, 14, 100], width: 5, height: baseHeight },
    ];
    expect(reconstructPageText(items)).toBe("Data");
  });

  it("preserves spaces between words with real horizontal gaps", () => {
    // "Data" then a gap then "design"
    const items: TestItem[] = [
      { str: "D", transform: [1, 0, 0, 1, 0, 100], width: 6, height: baseHeight },
      { str: "a", transform: [1, 0, 0, 1, 6, 100], width: 5, height: baseHeight },
      { str: "t", transform: [1, 0, 0, 1, 11, 100], width: 3, height: baseHeight },
      { str: "a", transform: [1, 0, 0, 1, 14, 100], width: 5, height: baseHeight },
      // gap > 0.25 * height = 3.0 → space
      { str: "d", transform: [1, 0, 0, 1, 30, 100], width: 5, height: baseHeight },
      { str: "e", transform: [1, 0, 0, 1, 35, 100], width: 5, height: baseHeight },
      { str: "s", transform: [1, 0, 0, 1, 40, 100], width: 3, height: baseHeight },
      { str: "i", transform: [1, 0, 0, 1, 43, 100], width: 2, height: baseHeight },
      { str: "g", transform: [1, 0, 0, 1, 45, 100], width: 6, height: baseHeight },
      { str: "n", transform: [1, 0, 0, 1, 51, 100], width: 6, height: baseHeight },
    ];
    expect(reconstructPageText(items)).toBe("Data design");
  });

  it("inserts newlines when y coordinate changes significantly", () => {
    const items: TestItem[] = [
      { str: "Line one", transform: [1, 0, 0, 1, 0, 100], width: 60, height: baseHeight },
      // y moved down by 50 ( > 0.4 * 12 = 4.8 )
      { str: "Line two", transform: [1, 0, 0, 1, 0, 150], width: 60, height: baseHeight },
    ];
    expect(reconstructPageText(items)).toBe("Line one\nLine two");
  });

  it("honors hasEOL for explicit line breaks", () => {
    const items: TestItem[] = [
      { str: "Hello", transform: [1, 0, 0, 1, 0, 100], width: 40, height: baseHeight, hasEOL: true },
      { str: "World", transform: [1, 0, 0, 1, 40, 100], width: 40, height: baseHeight },
    ];
    expect(reconstructPageText(items)).toBe("Hello\nWorld");
  });

  it("skips empty str items", () => {
    const items: TestItem[] = [
      { str: "A", transform: [1, 0, 0, 1, 0, 100], width: 6, height: baseHeight },
      { str: "", transform: [1, 0, 0, 1, 6, 100], width: 0, height: baseHeight },
      { str: "B", transform: [1, 0, 0, 1, 6, 100], width: 6, height: baseHeight },
    ];
    expect(reconstructPageText(items)).toBe("AB");
  });

  it("returns empty string for empty items", () => {
    expect(reconstructPageText([])).toBe("");
    expect(reconstructPageText([{ str: "", transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0 }])).toBe("");
  });
});

describe("normalizePageText", () => {
  it("collapses runs of spaces and tabs", () => {
    expect(normalizePageText("Hello    world\t\t\t!").trim()).toBe("Hello world !");
  });

  it("collapses 3+ newlines to 2 (paragraph break)", () => {
    expect(normalizePageText("Para1\n\n\n\nPara2").trim()).toBe("Para1\n\nPara2");
  });

  it("rejoins hyphenated line breaks", () => {
    expect(normalizePageText("architec-\ntural").trim()).toBe("architectural");
  });

  it("collapses soft line wraps within paragraphs to spaces", () => {
    expect(normalizePageText("Hello world.\nSecond sentence.").trim()).toBe("Hello world. Second sentence.");
  });

  it("handles the glyph-per-item safety net", () => {
    // "D a t a  d e s i g n" — high proportion of single-char tokens,
    // avg length < 2.5 → should collapse the single-letter runs into words.
    const garbled = "D a t a  d e s i g n";
    const result = normalizePageText(garbled);
    expect(result).toBe("Data design");
  });

  it("does not apply safety net to normal text", () => {
    const normal = "Data design is an important discipline in software engineering.";
    const result = normalizePageText(normal);
    expect(result).toBe(normal);
  });

  it("preserves paragraph breaks and collapses soft wraps", () => {
    const input = "First paragraph.\r\n\r\nSecond paragraph.";
    expect(normalizePageText(input)).toBe("First paragraph.\n\nSecond paragraph.");
  });
});
