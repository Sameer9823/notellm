import pdf from "pdf-parse";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export type PdfExtractResult = {
  pages: { page: number; text: string }[];
  pageCount: number;
  fullText: string;
};

type PdfTextItem = {
  str: string;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
  hasEOL?: boolean;
};

/**
 * Rebuilds page text from pdf.js text items using their geometry instead of
 * blindly joining with spaces.
 *
 * The default `content.items.map(item => item.str).join(" ")` produces garbled
 * output like "D a t a  d e s i g n" because glyph-level or fragment-level
 * items each get a space injected — even inside words. This walks items left-
 * to-right, top-to-bottom using each item's transform `[a,b,c,d,x,y]`,
 * `width`, and `height` to decide when to insert a space or a newline.
 */
export function reconstructPageText(items: unknown[]): string {
  const typed = items
    .map((i) => i as Partial<PdfTextItem> | TextItem)
    .filter(
      (item): item is PdfTextItem =>
        typeof item === "object" &&
        item !== null &&
        typeof item.str === "string" &&
        Array.isArray(item.transform) &&
        typeof (item.transform[4] ?? item.transform[5]) === "number" &&
        typeof item.width === "number" &&
        typeof item.height === "number"
    );

  if (typed.length === 0) return "";

  let out = "";
  let prev: PdfTextItem | null = null;
  // Running end position of the previous item (x + width) for gap detection.
  let prevEndX = 0;
  let prevY = 0;
  let prevHeight = 0;

  for (const item of typed) {
    const str = item.str;
    if (str.length === 0) continue;

    const x = item.transform[4];
    const y = item.transform[5];
    const h = item.height || 0;
    const w = item.width || 0;

    if (prev === null) {
      // First item on the page.
      out = str;
    } else {
      const dy = Math.abs(y - prevY);
      const yThreshold = h * 0.4 || prevHeight * 0.4 || 0;
      const gapX = x - prevEndX;

      if (dy > yThreshold || prev?.hasEOL) {
        // New line — different baseline or explicit EOL marker.
        out += "\n" + str;
      } else if (gapX > h * 0.25) {
        // Meaningful horizontal gap — likely a word boundary.
        out += " " + str;
      } else {
        // Tiny or negative gap — append directly with no space, which
        // repairs glyph/fragment-level splits inside a word.
        out += str;
      }
    }

    prev = item;
    prevEndX = x + w;
    prevY = y;
    prevHeight = h;
  }

  return out;
}

/** Normalises rebuilt page text: collapses whitespace runs, rejoins
 *  hyphenated line breaks, and applies a safety-net collapse for PDFs that
 *  emit every glyph as its own item (so even the geometry pass leaves
 *  single-character tokens spaced apart). */
export function normalizePageText(raw: string): string {
  let text = raw
    .replace(/\r\n/g, "\n")
    .replace(/[\t]+/g, " ");

  // Rejoin hyphenated line breaks — must happen before the soft-wrap collapse
  // below, which would turn the "\n" into a space and break the match.
  text = text.replace(/(\w)-\n(\w)/g, "$1$2");

  // Collapse 3+ newlines to a paragraph break (\n\n)
  text = text.replace(/\n{3,}/g, "\n\n");

  // Collapse single soft line wraps (within a paragraph) to spaces.
  // The regex matches a single \n that sits between two non-newline chars,
  // so \n\n (paragraph breaks) are left untouched.
  text = text.replace(/([^\n])\n([^\n])/g, "$1 $2");

  // Collapse runs of 3+ spaces to a single space, but PRESERVE double spaces
  // as potential word boundaries for the safety net below.
  text = text.replace(/   +/g, " ");

  text = text.trim();

  // Safety net: some PDFs emit glyph-level items where even the geometry
  // pass leaves 3+ single letters separated by single spaces
  // ("D a t a  d e s i g n"). Detect when that's happening and collapse
  // runs of single-char tokens (respecting double-space word boundaries)
  // into single words (e.g. "D a t a" → "Data").
  const tokens = text.split(/[ \n]+/).filter(Boolean);
  if (tokens.length > 4) {
    const singleChar = tokens.filter((t) => t.length === 1);
    const avgLen = tokens.reduce((sum, t) => sum + t.length, 0) / tokens.length;
    if (singleChar.length / tokens.length > 0.35 && avgLen < 2.5) {
      text = text.replace(/\b(?:\w )+\w\b/g, (m) => m.replace(/ /g, ""));
    }
  }

  // Final cleanup: collapse any remaining double/multiple spaces to single.
  text = text.replace(/  +/g, " ");

  return text;
}

/**
 * pdf-parse gives us full text plus a page render callback, which we use to
 * capture per-page text so each chunk can cite an exact page number.
 */
export async function extractPdf(buffer: Buffer): Promise<PdfExtractResult> {
  const pages: { page: number; text: string }[] = [];
  let currentPage = 0;

  const data = await pdf(buffer, {
    // pdf-parse awaits this at runtime even though @types/pdf-parse's
    // signature (still) declares it as sync-returning-string.
    pagerender: (async (pageData: { getTextContent: () => Promise<{ items: unknown[] }> }) => {
      currentPage += 1;
      const content = await pageData.getTextContent();
      const raw = reconstructPageText(content.items);
      const text = normalizePageText(raw);
      pages.push({ page: currentPage, text });
      return text;
    }) as unknown as (pageData: unknown) => string,
  });

  // Build fullText from our own per-page reconstruction so it's consistent
  // with the chunks (which are built from the same `pages` array), rather
  // than relying on pdf-parse's internal concatenation.
  const fullText = pages.map((p) => p.text).join("\n\n");

  return { pages, pageCount: data.numpages, fullText };
}
