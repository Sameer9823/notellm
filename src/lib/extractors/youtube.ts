import { Innertube } from "youtubei.js";
import { YoutubeTranscript } from "youtube-transcript";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { Cue } from "@/lib/chunking";
import { describeError } from "@/lib/utils";

export type YoutubeExtractResult = {
  videoId: string;
  title: string;
  cues: Cue[];
  durationSec: number;
  /** Best-effort ISO 639-1 code for the caption track's language, when the
   *  extraction method reports one (e.g. "en", "hi"). Undefined when the
   *  method doesn't tell us — the caller falls back to LLM detection. */
  captionLang?: string;
};

export function parseYoutubeId(url: string): string {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  throw new Error("Could not parse a YouTube video id from that URL");
}

// --- Proxy setup -----------------------------------------------------
const PROXY_URL = process.env.YT_PROXY_URL; // http://user:pass@p.webshare.io:80
const proxyAgent = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;

async function proxiedFetch(input: any, init: any = {}): Promise<Response> {
  const cleanInit = { ...init };

  // youtubei.js sometimes calls fetch with a Request object instead of a
  // plain URL string. undici's ProxyAgent dispatch path doesn't reliably
  // unwrap Request instances, and stringifying one produces the literal
  // text "[object Request]" — which then fails URL parsing. Normalize to
  // a plain string URL (and pull method/headers/body off the Request if
  // present) so undici always gets what it expects.
  let url: string;
  if (typeof input === "string") {
    url = input;
  } else if (input && typeof input === "object" && "url" in input) {
    // Request-like object
    url = input.url;
    cleanInit.method = cleanInit.method ?? input.method;
    cleanInit.headers = cleanInit.headers ?? input.headers;
    if (input.body && !("body" in cleanInit)) {
      cleanInit.body = input.body;
    }
  } else {
    url = String(input);
  }

  // GET/HEAD requests must not carry a body.
  const method = (cleanInit.method ?? "GET").toUpperCase();
  if ((method === "GET" || method === "HEAD") && "body" in cleanInit) {
    delete cleanInit.body;
  }

  if (proxyAgent) {
    cleanInit.dispatcher = proxyAgent;
  }

  return undiciFetch(url, cleanInit) as unknown as Promise<Response>;
}
// -----------------------------------------------------------------------

/** Fetches a video's real title through several independent paths, in
 *  order, stopping at the first success. This exists because the plain
 *  oembed fetch used to be a single unproxied call — on hosts where
 *  YouTube blocks the outbound IP (the same reason SEARCHAPI_KEY/proxy
 *  exist at all) that call silently failed and the source was left named
 *  after its bare video id. Every attempt here goes through the proxy
 *  when one is configured. */
async function fetchVideoTitle(videoId: string, url: string): Promise<string | null> {
  // 1. YouTube's own oembed endpoint, via the proxy.
  try {
    const res = await proxiedFetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (res.ok) {
      const title = ((await res.json()) as { title?: string }).title;
      if (title && title.trim()) return title.trim();
    }
  } catch {
    // fall through
  }

  // 2. noembed.com — a third-party oembed mirror that isn't subject to
  // the same per-IP blocking YouTube applies to its own endpoints.
  try {
    const res = await proxiedFetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const title = ((await res.json()) as { title?: string }).title;
      if (title && title.trim()) return title.trim();
    }
  } catch {
    // fall through
  }

  // 3. Innertube's lightweight metadata lookup, already proxy-aware.
  try {
    const yt = await getInnertube();
    const info = await yt.getBasicInfo(videoId);
    const title = info.basic_info.title;
    if (title && title.trim()) return title.trim();
  } catch {
    // give up — caller falls back to the video id
  }

  return null;
}

let innertube: Innertube | null = null;
async function getInnertube(forceFresh = false): Promise<Innertube> {
  if (forceFresh) innertube = null;
  if (!innertube) {
    innertube = await Innertube.create({
      retrieve_player: false,
      generate_session_locally: true,
      fetch: proxiedFetch as any,
    });
  }
  return innertube;
}

// --- SearchApi.io fallback ---------------------------------------------
// YouTube blocks datacenter/cloud IPs (Vercel, AWS, GCP, etc.) from hitting
// its internal transcript/innertube endpoints, so direct extraction that
// works locally often fails once deployed. SearchApi.io proxies the
// request through its own infra, sidestepping the IP block entirely.
// Docs: https://www.searchapi.io/docs/youtube-transcripts
const SEARCHAPI_KEY = process.env.SEARCHAPI_API_KEY;

type SearchApiTranscriptSegment = { text: string; start: number; duration: number };
type SearchApiTranscriptResponse = {
  transcripts?: SearchApiTranscriptSegment[];
  available_languages?: { name: string; lang: string }[];
  error?: string;
};

async function extractViaSearchApi(videoId: string, url: string): Promise<YoutubeExtractResult> {
  if (!SEARCHAPI_KEY) {
    throw new Error("SEARCHAPI_API_KEY is not set");
  }

  const params = new URLSearchParams({
    engine: "youtube_transcripts",
    video_id: videoId,
    lang: "en",
    only_available: "true", // fall back to any available language rather than erroring
    api_key: SEARCHAPI_KEY,
  });

  const res = await fetch(`https://www.searchapi.io/api/v1/search?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`SearchApi request failed with status ${res.status}`);
  }

  const data = (await res.json()) as SearchApiTranscriptResponse;

  if (data.error) {
    throw new Error(`SearchApi: ${data.error}`);
  }
  if (!data.transcripts || !data.transcripts.length) {
    throw new Error("SearchApi returned no transcript segments for this video");
  }

  const cues: Cue[] = data.transcripts
    .map((seg) => ({
      start: Math.round(seg.start),
      end: Math.round(seg.start + seg.duration),
      text: seg.text.trim(),
    }))
    .filter((c) => c.text.length > 0);

  if (!cues.length) throw new Error("SearchApi transcript had no usable text");

  // SearchApi's transcript engine doesn't return video title/duration, so
  // fetch those separately. This previously used a single unproxied
  // `fetch()` call to YouTube's oembed endpoint, which silently failed
  // (and left the source titled after its bare video id) on hosts where
  // YouTube blocks the server's outbound IP — the exact scenario
  // SEARCHAPI_KEY exists to route around. `fetchVideoTitle` retries
  // through the proxy and two independent fallbacks instead.
  const title = (await fetchVideoTitle(videoId, url)) ?? videoId;

  // SearchApi doesn't tell us which language it actually served when
  // `only_available` falls back off the requested `lang`, so we can't
  // trust `data.search_parameters?.lang` here — leave captionLang unset
  // and let the caller detect it from the text itself.
  return { videoId, title, cues, durationSec: cues[cues.length - 1].end };
}
// -----------------------------------------------------------------------

export async function extractYoutube(url: string): Promise<YoutubeExtractResult> {
  const videoId = parseYoutubeId(url);

  // SearchApi first when configured — it's the reliable path in production
  // since it isn't subject to YouTube's per-IP blocking of this server.
  if (SEARCHAPI_KEY) {
    try {
      return await extractViaSearchApi(videoId, url);
    } catch (searchApiErr) {
      // Fall through to the direct methods below as a backup.
      try {
        return await extractViaInnertube(videoId);
      } catch {
        try {
          return await extractViaScraper(videoId, url);
        } catch (fallbackErr) {
          throw new Error(
            `Couldn't fetch captions for this video. SearchApi: ${describeError(
              searchApiErr
            )}. Fallback method: ${describeError(fallbackErr)}.`
          );
        }
      }
    }
  }

  try {
    return await extractViaInnertube(videoId);
  } catch (primaryErr) {
    try {
      return await extractViaInnertube(videoId, /* forceFresh */ true);
    } catch (retryErr) {
      try {
        return await extractViaScraper(videoId, url);
      } catch (fallbackErr) {
        throw new Error(
          `Couldn't fetch captions for this video. This usually means either ` +
            `(a) the video genuinely has no captions/auto-captions enabled, or ` +
            `(b) YouTube is blocking this server's IP and needs a working proxy or ` +
            `SEARCHAPI_API_KEY configured. ` +
            `Primary method: ${describeError(retryErr ?? primaryErr)}. Fallback method: ${describeError(
              fallbackErr
            )}.`
        );
      }
    }
  }
}

async function extractViaInnertube(videoId: string, forceFresh = false): Promise<YoutubeExtractResult> {
  const yt = await getInnertube(forceFresh);
  const info = await yt.getInfo(videoId);

  const transcriptData = await info.getTranscript();
  const segments = transcriptData?.transcript?.content?.body?.initial_segments;

  if (!segments || !segments.length) {
    throw new Error("No caption track is available for this video");
  }

  const cues: Cue[] = segments
    .filter((s: { snippet?: { text?: string; toString?: () => string } }) => "snippet" in s && s.snippet)
    .map((s: { start_ms: string | number; end_ms: string | number; snippet: { text?: string; toString: () => string } }) => ({
      start: Math.round(Number(s.start_ms) / 1000),
      end: Math.round(Number(s.end_ms) / 1000),
      text: (s.snippet.text ?? s.snippet.toString()).trim(),
    }))
    .filter((c: Cue) => c.text.length > 0);

  if (!cues.length) throw new Error("No caption text could be parsed for this video");

  const title = info.basic_info.title || (await fetchVideoTitle(videoId, `https://www.youtube.com/watch?v=${videoId}`)) || videoId;
  const durationSec = info.basic_info.duration ?? cues[cues.length - 1].end;

  return { videoId, title, cues, durationSec };
}

async function extractViaScraper(videoId: string, url: string): Promise<YoutubeExtractResult> {
  const transcript = await YoutubeTranscript.fetchTranscript(videoId);
  if (!transcript.length) throw new Error("This video has no captions available to index");

  const cues: Cue[] = transcript.map((t) => ({
    start: Math.round(t.offset / 1000),
    end: Math.round((t.offset + t.duration) / 1000),
    text: t.text,
  }));

  const title = (await fetchVideoTitle(videoId, url)) ?? videoId;

  return { videoId, title, cues, durationSec: cues[cues.length - 1].end };
}