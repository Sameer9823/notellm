"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink, FileSearch } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { sourceTypeIcon, formatTimestamp } from "@/lib/source-meta";
import { cn } from "@/lib/utils";
import type { Citation, SourceType } from "@/types";

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
  };
  chunks: ChunkDTO[];
};

/**
 * The "you'll never get an answer without knowing where it came from" panel.
 * Clicking a citation opens the originating source here with the exact
 * cited chunk scrolled into view and highlighted — a PDF page, a transcript
 * span with its timestamp, a text passage, or a web article's extract.
 */
export function StudioPanel({ citation, onClose }: { citation: Citation | null; onClose: () => void }) {
  const [data, setData] = useState<SourceContent | null>(null);
  const [loading, setLoading] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!citation) return;
    setLoading(true);
    setData(null);
    fetch(`/api/sources/${citation.sourceId}/content?chunkId=${citation.chunkId}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [citation]);

  useEffect(() => {
    if (data && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [data]);

  return (
    <AnimatePresence>
      {citation && (
        <motion.aside
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className="fixed inset-0 z-50 overflow-hidden bg-card lg:static lg:z-auto lg:h-full lg:w-[380px] lg:shrink-0 lg:border-l lg:border-border lg:bg-card/40"
        >
          <div className="flex h-full w-full flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <FileSearch className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Source viewer</span>
              </div>
              <div className="flex items-center gap-1">
                {data?.source.originUrl && (
                  <a href={data.source.originUrl} target="_blank" rel="noreferrer">
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

            <ScrollArea className="flex-1">
              <div className="p-4">
                {loading && (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                )}

                {data && data.source.type === "YOUTUBE" && data.source.metadata?.videoId ? (
                  <>
                    <SourceHeader source={data.source} />
                    <YoutubeEmbed videoId={data.source.metadata.videoId} startSec={citation.startSec ?? 0} title={data.source.title} />
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
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
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