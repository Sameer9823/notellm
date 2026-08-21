import webvtt from "node-webvtt";
import type { Cue } from "@/lib/chunking";

export type VttExtractResult = {
  cues: Cue[];
  durationSec: number;
};

/** Parses a WebVTT (or plain SRT-like) transcript file into timed cues. */
export function extractVtt(raw: string): VttExtractResult {
  const trimmed = raw.trim();
  const isVtt = trimmed.startsWith("WEBVTT");
  // SRT timestamps use a comma as the decimal separator (00:00:01,000)
  // where WebVTT requires a period (00:00:01.000). node-webvtt's parser
  // doesn't throw on the comma form — it just silently returns zero cues,
  // even with `strict: false`. .srt uploads are explicitly supported
  // (use-add-source's inferFileType treats .srt as a "VTT" source), so
  // without this conversion every .srt upload extracted to zero cues and
  // failed with "No cues could be parsed from this transcript file".
  const body = trimmed.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  const normalized = isVtt ? body : `WEBVTT\n\n${body}`;
  const parsed = webvtt.parse(normalized, { strict: false });

  const cues: Cue[] = parsed.cues.map((c: { start: number; end: number; text: string }) => ({
    start: Math.round(c.start),
    end: Math.round(c.end),
    text: c.text.replace(/<[^>]+>/g, "").trim(),
  }));

  if (!cues.length) throw new Error("No cues could be parsed from this transcript file");

  return { cues, durationSec: cues[cues.length - 1].end };
}
