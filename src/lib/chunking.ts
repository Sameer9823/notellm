/**
 * Chunking strategy
 * ------------------
 * Plain-text / URL sources: sentence-aware sliding window (~450 tokens,
 * ~80 token overlap) over the flat text, tracking character offsets so a
 * citation can be re-highlighted in the original document.
 *
 * PDF: chunked per-page-group — we chunk within each page's text so every
 * chunk can carry a single, unambiguous page number for citation deep-links.
 *
 * YouTube / VTT: chunked over caption cues, grouping consecutive cues up to
 * the token budget so every chunk keeps a precise [startSec, endSec] range
 * for "jump to timestamp" citations.
 *
 * A rough 4-chars-per-token heuristic avoids pulling in a tokenizer dependency
 * for a step where exactness matters far less than consistent, deep-linkable
 * boundaries.
 */

const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 450;
const OVERLAP_TOKENS = 80;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

export type TextChunk = {
  index: number;
  content: string;
  tokenCount: number;
  startChar?: number;
  endChar?: number;
  page?: number;
  startSec?: number;
  endSec?: number;
};

const SENTENCE_BOUNDARY = /(?<=[.!?。！？])[ \t]+/;

/** Splits flat text into overlapping, sentence-respecting chunks with char offsets.
 *  Paragraph breaks (\n\n) are preserved so chunk content keeps meaningful
 *  structure instead of flattening everything into one run-on line. */
export function chunkPlainText(text: string): TextChunk[] {
  const clean = text
    .replace(/\r\n/g, "\n")
    .replace(/([ \t])+/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([^\n])[ \t]*\n([^\n])/g, "$1 $2")
    .trim();
  if (!clean) return [];

  const sentences: { text: string; start: number }[] = [];
  // After splitting on sentence boundaries, each raw sentence may be far
  // larger than TARGET_CHARS (e.g. un-punctuated text becomes a single
  // 50k-char "sentence"). splitOversized cuts any such run into pieces <=
  // TARGET_CHARS so embedding never hits the model's input limit, while
  // preserving absolute character offsets for citation deep-links.
  const splitOversized = (text: string, start: number): { text: string; start: number }[] => {
    if (text.length <= TARGET_CHARS) return [{ text, start }];
    const pieces: { text: string; start: number }[] = [];
    let pos = start;
    let remaining = text;
    while (remaining.length > TARGET_CHARS) {
      const window = remaining.slice(0, TARGET_CHARS);
      const lastSpace = window.lastIndexOf(" ");
      // Only split at a space if it's past the half-way point of the window;
      // otherwise hard-cut at TARGET_CHARS to guarantee every piece fits.
      const splitAt = lastSpace > TARGET_CHARS / 2 ? lastSpace : TARGET_CHARS;
      pieces.push({ text: remaining.slice(0, splitAt), start: pos });
      pos += splitAt;
      remaining = remaining.slice(splitAt);
    }
    if (remaining.length > 0) pieces.push({ text: remaining, start: pos });
    return pieces;
  };

  let cursor = 0;
  for (const part of clean.split(SENTENCE_BOUNDARY)) {
    if (!part) continue;
    const start = clean.indexOf(part, cursor);
    const actualStart = start === -1 ? cursor : start;
    for (const piece of splitOversized(part, actualStart)) {
      sentences.push(piece);
    }
    cursor = actualStart + part.length;
  }

  const chunks: TextChunk[] = [];
  let buffer: typeof sentences = [];
  let bufferChars = 0;
  // Tracks whether the buffer has received a sentence since the last flush.
  // After a flush, only the overlap carry is left in the buffer — if the
  // input ends right then, the trailing flush() must NOT emit that overlap
  // as a standalone chunk, which would duplicate the tail of the previous
  // chunk. hasNew is set true whenever a sentence is pushed, and reset to
  // false right after the overlap carry so flush() can skip an empty emit.
  let hasNew = false;

  const flush = () => {
    if (!hasNew) return;
    if (!buffer.length) return;
    const start = buffer[0].start;
    const last = buffer[buffer.length - 1];
    const end = last.start + last.text.length;
    const content = clean.slice(start, end).trim();
    if (content) {
      chunks.push({
        index: chunks.length,
        content,
        tokenCount: Math.ceil(content.length / CHARS_PER_TOKEN),
        startChar: start,
        endChar: end,
      });
    }
  };

  for (const sentence of sentences) {
    buffer.push(sentence);
    bufferChars += sentence.text.length;
    hasNew = true;
    if (bufferChars >= TARGET_CHARS) {
      flush();
      // carry overlap: keep trailing sentences whose combined length
      // fits within OVERLAP_CHARS. Using <= (instead of <) ensures a
      // single oversized sentence that exceeds OVERLAP_CHARS on its own
      // is dropped from the carry rather than forcing itself into every
      // subsequent chunk.
      let overlap = 0;
      let i = buffer.length - 1;
      const kept: typeof sentences = [];
      while (i >= 0 && overlap + buffer[i].text.length <= OVERLAP_CHARS) {
        kept.unshift(buffer[i]);
        overlap += buffer[i].text.length;
        i--;
      }
      buffer = kept;
      bufferChars = overlap;
      hasNew = false;
    }
  }
  flush();

  return chunks;
}

/** Chunks PDF text that has already been split by page, preserving page numbers. */
export function chunkPages(pages: { page: number; text: string }[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (const { page, text } of pages) {
    const pageChunks = chunkPlainText(text);
    for (const c of pageChunks) {
      chunks.push({ ...c, index: chunks.length, page });
    }
  }
  return chunks;
}

export type Cue = { start: number; end: number; text: string };

/** Groups consecutive caption cues (YouTube transcript / VTT) up to the token budget. */
export function chunkCues(cues: Cue[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  let buffer: Cue[] = [];
  let bufferChars = 0;

  const flush = () => {
    if (!buffer.length) return;
    const content = buffer.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
    if (content) {
      chunks.push({
        index: chunks.length,
        content,
        tokenCount: Math.ceil(content.length / CHARS_PER_TOKEN),
        startSec: buffer[0].start,
        endSec: buffer[buffer.length - 1].end,
      });
    }
  };

  for (const cue of cues) {
    buffer.push(cue);
    bufferChars += cue.text.length;
    if (bufferChars >= TARGET_CHARS) {
      flush();
      buffer = [];
      bufferChars = 0;
    }
  }
  flush();

  return chunks;
}

export function formatTimestamp(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
