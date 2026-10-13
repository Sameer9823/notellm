import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { safeFetch, validateAndResolveUrl } from "@/lib/ssrf";
import { parseEmbedHeaders } from "@/lib/embed-check";
import { extractUrl } from "@/lib/extractors/url";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const READER_TEXT_LIMIT = 20_000;

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url query param is required" }, { status: 400 });
  }

  // SSRF-protect the URL before doing anything with it — http(s) only,
  // private-IP rejection, hostname metadata checks.
  const validation = await validateAndResolveUrl(url);
  if (!validation.ok) {
    return NextResponse.json({ embeddable: false, finalUrl: url, error: validation.error });
  }

  // Rate-limit per user — each preview is an outbound fetch, so cap how
  // often a single user can hammer this endpoint.
  const rl = await checkRateLimit(`ratelimit:webpreview:${userId}`, RATE_LIMITS.webPreview.limit, RATE_LIMITS.webPreview.windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  // HEAD first — we only need headers for the embeddability check, and many
  // sites happily serve headers via HEAD without sending the body. Falls back
  // to GET (aborted after headers) when HEAD isn't supported.
  let res: Response;
  try {
    try {
      res = await safeFetch(url, { method: "HEAD" });
    } catch {
      // HEAD failed — fall back to a GET we abort after reading headers.
      const controller = new AbortController();
      res = await safeFetch(url, { method: "GET", signal: controller.signal });
      // We have the headers; cancel the body download.
      controller.abort();
      // Touch the body to be a good citizen, but ignore the content — we
      // only needed the headers. The actual page text comes from extractUrl.
      res.body?.cancel().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ embeddable: false, finalUrl: url, error: msg });
  }

  // Only 2xx responses are considered for embedding — a 4xx/5xx might be a
  // block page with permissive headers, not the real content.
  if (!res.ok) {
    return NextResponse.json({
      embeddable: false,
      finalUrl: res.url || url,
      error: `Upstream returned ${res.status}`,
    });
  }

  const { embeddable, reason } = parseEmbedHeaders(res.headers);
  const finalUrl = res.url || url;

  if (embeddable) {
    return NextResponse.json({ embeddable: true, finalUrl });
  }

  // Not embeddable — fetch reader content via Readability / Firecrawl so the
  // Studio panel can show an extracted-text reader view instead of an iframe.
  let reader: { title: string; text: string } | null = null;
  try {
    reader = await extractUrl(finalUrl);
  } catch {
    // Reader extraction is best-effort; the Studio panel falls back to
    // whatever it already has (stored chunks or the snippet).
  }

  return NextResponse.json({
    embeddable: false,
    finalUrl,
    reason,
    title: reader?.title,
    text: reader?.text?.slice(0, READER_TEXT_LIMIT),
  });
}
