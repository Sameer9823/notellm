"use client";

import { useEffect, useRef, useState, useCallback, type RefObject } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink, FileSearch } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { sourceTypeIcon, formatTimestamp } from "@/lib/source-meta";
import { cn } from "@/lib/utils";
import type { Citation, SourceType } from "@/types";
import type { WebPreviewResult } from "./web-preview-types";

// pdf.js uses browser-only APIs (worker, canvas), so it must never be
// server-rendered — load it with SSR disabled and let the browser take over.
const PdfViewer = dynamic(
  () => import("@/components/studio/PdfViewer").then((mod) => mod.PdfViewer),
  { ssr: false, loading: () => <Skeleton className="h-96 w-full" /> }
);

type ChunkDTO = {
  id: string;
  index: number;
  content: string;
  page?: number | null;
  startSec?: number | null;
  endSec?: number | null;
};

type SourceContent = {
  source: {
    id: string;
    type: SourceType;
    title: string;
    originUrl?: string | null;
    pageCount?: number | null;
    durationSec?: number | null;
    language?: string | null;
    metadata?: { videoId?: string } | null;
    hasFile?: boolean;
  };
  chunks: ChunkDTO[];
};

function textHashFragment(snippet: string): string {
  const words = snippet.trim().split(/\s+/).slice(0, 8);
  return `#:~:text=${encodeURIComponent(words.join(" "))}`;
}

const IS_WIDE_TYPE = new Set<SourceType>(["PDF", "WEB", "URL"]);

/**
 * The "you'll never get an answer without knowing where it came from" panel.
 * Clicking a citation opens the originating source here with the exact
 * cited chunk scrolled into view and highlighted — a PDF page, a transcript
 * span with its timestamp, a text passage, a live/embedded web page, or
 * a screenshot snapshot of a non-embeddable site.
 */
export function StudioPanel({ citation, onClose }: { citation: Citation | null; onClose: () => void }) {
  const [data, setData] = useState<SourceContent | null>(null);
  const [loading, setLoading] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);

  /** WEB/URL viewer state */
  const [webPreview, setWebPreview] = useState<WebPreviewResult | null>(null);
  const [webLoading, setWebLoading] = useState(false);

  const isWebSource = citation?.sourceType === "WEB" || citation?.sourceType === "URL";
  const previewUrl = isWebSource
    ? (citation?.sourceType === "WEB" ? citation?.url : data?.source.originUrl) ?? null
    : null;

  useEffect(() => {
    if (!citation) return;
    // WEB citations have no sourceId — skip the source-content fetch.
    if (citation.sourceType === "WEB") return;

    setLoading(true);
    setData(null);
    fetch(`/api/sources/${citation.sourceId}/content?chunkId=${citation.chunkId}`)
      .then((r) => r.json())
       .then((d) => {
         setData(d);
       })
      .finally(() => setLoading(false));
  }, [citation]);

  // Fetch embeddability for WEB/URL citations once we have a URL.
  useEffect(() => {
    if (!isWebSource || !previewUrl) return;
    setWebPreview(null);
    setWebLoading(true);
    fetch(`/api/web-preview?url=${encodeURIComponent(previewUrl)}`)
      .then((r) => r.json())
      .then((d) => setWebPreview(d))
      .catch(() => setWebPreview({ embeddable: false, finalUrl: previewUrl ?? "", error: "Could not check embeddability" }))
      .finally(() => setWebLoading(false));
  }, [citation, isWebSource, previewUrl, data]);

  // Scroll to the highlighted paragraph / chunk when data or web preview changes.
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [data, webPreview]);

  return (
    <AnimatePresence>
      {citation && (
        <motion.aside
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className={cn(
            "fixed inset-0 z-50 overflow-hidden bg-card lg:static lg:z-auto lg:h-full lg:shrink-0 lg:border-l lg:border-border lg:bg-card/40",
            IS_WIDE_TYPE.has(citation.sourceType) ? "lg:w-[560px]" : "lg:w-[380px]"
          )}
        >
          <div className="flex h-full w-full flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <FileSearch className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Source viewer</span>
              </div>
              <div className="flex items-center gap-1">
                {previewUrl && (
                  <a
                    href={previewUrl + textHashFragment(citation.snippet)}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in new tab"
                  >
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* === WEB / URL viewer === */}
            {isWebSource ? (
              <>
                {webLoading && (
                  <div className="p-4 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                )}

                {webPreview?.embeddable === true && (
                  <div className="flex-1 min-h-0">
                    <iframe
                      key={webPreview?.finalUrl}
                      src={webPreview?.finalUrl ?? previewUrl ?? ""}
                      title={citation.sourceTitle}
                      sandbox="allow-scripts allow-same-origin allow-popups"
                      referrerPolicy="no-referrer"
                      className="h-full w-full border-0"
                    />
                  </div>
                )}

                {webPreview?.embeddable === false && (
                  <>
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      This site doesn't allow embedding, showing extracted text
                    </div>
                    <div className="flex-1 min-h-0">
                      <ScrollArea className="h-full">
                        <div className="p-4">
                          {(webPreview.title || data?.source?.title) && (
                            <h3 className="font-display text-sm font-semibold">
                              {webPreview.title ?? data?.source?.title}
                            </h3>
                          )}
                          {data && data.chunks.length > 0 ? (
                            <div className="mt-4 space-y-3 font-mono text-[13px] leading-relaxed">
                              {data.chunks.map((c) => {
                                const isHighlighted = c.id === citation.chunkId;
                                return (
                                  <div
                                    key={c.id}
                                    ref={isHighlighted ? highlightRef : undefined}
                                    className={cn(
                                      "rounded-md border px-2.5 py-2 transition-colors",
                                      isHighlighted ? "border-primary/50 bg-primary/10" : "border-transparent"
                                    )}
                                  >
                                    {(c.page != null || c.startSec != null) && (
                                      <div className="mb-1 font-sans text-[10px] uppercase tracking-wide text-muted-foreground">
                                        {c.page != null ? `Page ${c.page}` : `${formatTimestamp(c.startSec!)} – ${formatTimestamp(c.endSec ?? 0)}`}
                                      </div>
                                    )}
                                    <p className="whitespace-pre-wrap text-foreground/90">{c.content}</p>
                                  </div>
                                );
                              })}
                            </div>
                          ) : webPreview.text ? (
                            <ReaderParagraphs
                              text={webPreview.text}
                              snippet={citation.snippet}
                              highlightRef={highlightRef}
                            />
                          ) : citation.snippet ? (
                            <div
                              ref={highlightRef}
                              className="mt-4 rounded-md border border-primary/50 bg-primary/10 px-2.5 py-2"
                            >
                              <p className="whitespace-pre-wrap text-foreground/90">{citation.snippet}</p>
                            </div>
                          ) : (
                            <p className="mt-4 text-xs text-muted-foreground">No text content available.</p>
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  </>
                )}
              </>
            ) : data &&
              data.source.type === "PDF" &&
              data.source.hasFile &&
              citation.page != null ? (
              <div className="flex-1 min-h-0">
                <PdfViewer
                  sourceId={citation.sourceId}
                  page={citation.page}
                  highlight={data.chunks.find((c) => c.id === citation.chunkId)?.content}
                />
              </div>
            ) : loading ? (
              <ScrollArea className="flex-1">
                <div className="p-4">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              </ScrollArea>
            ) : (
              <ScrollArea className="flex-1">
                <div className="p-4">
                  {data &&
                    data.source.type === "PDF" &&
                    !data.source.hasFile && (
                      <div className="mb-3 rounded-md bg-amber-50/20 px-3 py-2 text-xs text-amber-600">
                        Original PDF isn't stored for this source. Re-upload it to see the real page.
                      </div>
                    )}

                  {data && data.source.type === "YOUTUBE" && data.source.metadata?.videoId ? (
                    <>
                      <SourceHeader source={data.source} />
                      <YoutubeEmbed
                        videoId={data.source.metadata.videoId}
                        startSec={citation.startSec ?? 0}
                        title={data.source.title}
                      />
                    </>
                  ) : data ? (
                    <>
                      <SourceHeader source={data.source} />
                      <div className="mt-4 space-y-3 font-mono text-[13px] leading-relaxed">
                        {data.chunks.map((c) => {
                          const isHighlighted = c.id === citation.chunkId;
                          return (
                            <div
                              key={c.id}
                              ref={isHighlighted ? highlightRef : undefined}
                              className={cn(
                                "rounded-md border px-2.5 py-2 transition-colors",
                                isHighlighted ? "border-primary/50 bg-primary/10" : "border-transparent"
                              )}
                            >
                              {(c.page != null || c.startSec != null) && (
                                <div className="mb-1 font-sans text-[10px] uppercase tracking-wide text-muted-foreground">
                                  {c.page != null ? `Page ${c.page}` : `${formatTimestamp(c.startSec!)} – ${formatTimestamp(c.endSec ?? 0)}`}
                                </div>
                              )}
                              <p className="whitespace-pre-wrap text-foreground/90">{c.content}</p>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                </div>
              </ScrollArea>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function ReaderParagraphs({
  text,
  snippet,
  highlightRef,
}: {
  text: string;
  snippet: string;
  highlightRef: RefObject<HTMLDivElement | null>;
}) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const snippetNorm = snippet.trim().toLowerCase();
  const firstWords = snippetNorm.split(/\s+/).slice(0, 8).join(" ");

  const matchScore = (para: string): number => {
    const paraNorm = para.toLowerCase();
    if (!snippetNorm) return 0;
    // Direct substring (case-insensitive, normalized)
    if (paraNorm.includes(snippetNorm)) return 3;
    if (paraNorm.includes(firstWords) && firstWords.length > 10) return 2;
    // N-gram overlap: check if 4 consecutive words from the snippet appear
    const snippetWords = snippetNorm.split(/\s+/).filter((w) => w.length > 2);
    if (snippetWords.length >= 4) {
      let best = 0;
      for (let i = 0; i <= snippetWords.length - 4; i++) {
        const ngram = snippetWords.slice(i, i + 4).join(" ");
        if (paraNorm.includes(ngram)) best = Math.max(best, 1);
      }
      return best;
    }
    return 0;
  };

  let firstHighlightSet = false;

  return (
    <div className="mt-4 space-y-3 font-mono text-[13px] leading-relaxed">
      {paragraphs.map((para, i) => {
        const score = matchScore(para);
        const isHighlighted = score >= 2;
        const isFirstHighlight = !firstHighlightSet && score >= 2 && (firstHighlightSet = true);
        return (
          <div
            key={i}
            ref={isFirstHighlight ? highlightRef : undefined}
            className={cn(
              "rounded-md border px-2.5 py-2 transition-colors",
              isHighlighted ? "border-primary/50 bg-primary/10" : "border-transparent"
            )}
          >
            <p className="whitespace-pre-wrap text-foreground/90">{para}</p>
          </div>
        );
      })}
    </div>
  );
}

/** Embeds the YouTube player directly at a citation's timestamp, instead of
 *  showing a scrollable transcript — clicking a different timestamp citation
 *  re-mounts the iframe (via `key`) so it jumps straight to the new time. */
function YoutubeEmbed({ videoId, startSec, title }: { videoId: string; startSec: number; title: string }) {
  return (
    <div className="mt-4 aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
      <iframe
        key={`${videoId}-${startSec}`}
        src={`https://www.youtube.com/embed/${videoId}?start=${Math.max(0, Math.floor(startSec))}&autoplay=1`}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="h-full w-full"
      />
    </div>
  );
}

const LANGUAGE_NAMES: Record<string, string> = {
  hi: "Hindi", es: "Spanish", fr: "French", de: "German", ja: "Japanese",
  ko: "Korean", zh: "Chinese", ar: "Arabic", pt: "Portuguese", ru: "Russian",
  it: "Italian", ta: "Tamil", te: "Telugu", bn: "Bengali", mr: "Marathi",
  gu: "Gujarati", pa: "Punjabi", ur: "Urdu",
};

function SourceHeader({ source }: { source: SourceContent["source"] }) {
  const Icon = sourceTypeIcon[source.type];
  const lang = source.language;
  const langName = lang && lang !== "en" ? LANGUAGE_NAMES[lang] ?? lang.toUpperCase() : null;
  return (
    <div className="flex items-start gap-2 border-b border-border pb-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <h4 className="truncate font-display text-sm font-semibold">{source.title}</h4>
        <p className="text-[11px] text-muted-foreground">
          {source.pageCount ? `${source.pageCount} pages` : source.durationSec ? formatTimestamp(source.durationSec) + " total" : "Text source"}
        </p>
        {langName && (
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">
            Translated to English from {langName}
          </p>
        )}
      </div>
    </div>
  );
}
