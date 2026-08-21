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

const SENTENCE_BOUNDARY = /(?<=[.!?。！？])\s+/;

/** Splits flat text into overlapping, sentence-respecting chunks with char offsets. */
export function chunkPlainText(text: string): TextChunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const sentences: { text: string; start: number }[] = [];
  let cursor = 0;
  for (const part of clean.split(SENTENCE_BOUNDARY)) {
    if (!part) continue;
    const start = clean.indexOf(part, cursor);
    sentences.push({ text: part, start: start === -1 ? cursor : start });
    cursor = (start === -1 ? cursor : start) + part.length;
  }

  const chunks: TextChunk[] = [];
  let buffer: typeof sentences = [];
  let bufferChars = 0;

  const flush = () => {
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
    if (bufferChars >= TARGET_CHARS) {
      flush();
      // carry overlap: keep trailing sentences whose combined length ~ OVERLAP_CHARS
      let overlap = 0;
      let i = buffer.length - 1;
      const kept: typeof sentences = [];
      while (i >= 0 && overlap < OVERLAP_CHARS) {
        kept.unshift(buffer[i]);
        overlap += buffer[i].text.length;
        i--;
      }
      buffer = kept;
      bufferChars = overlap;
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
