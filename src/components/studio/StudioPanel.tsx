"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type RefObject,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import {
  X,
  ExternalLink,
  FileSearch,
  AlertCircle,
  RefreshCw,
  WifiOff,
  Monitor,
  Tablet,
  Smartphone,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { sourceTypeIcon, formatTimestamp } from "@/lib/source-meta";
import { cn } from "@/lib/utils";
import type { Citation, SourceType } from "@/types";
import type { WebPreviewResult, EmbeddableResult } from "./web-preview-types";
import { Empty } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { ScaledIframe, type ViewMode } from "./ScaledIframe";

// pdf.js uses browser-only APIs (worker, canvas), so it must never be
// server-rendered — load it with SSR disabled and let the browser take over.
const PdfViewer = dynamic(
  () => import("@/components/studio/PdfViewer").then((mod) => mod.PdfViewer),
  { ssr: false, loading: () => <Skeleton className="h-96 w-full" /> },
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

const DEVICE_MODES: { id: ViewMode; label: string; icon: ReactNode }[] = [
  { id: "desktop", label: "Desktop", icon: <Monitor className="h-3.5 w-3.5" /> },
  { id: "tablet", label: "Tablet", icon: <Tablet className="h-3.5 w-3.5" /> },
  { id: "mobile", label: "Mobile", icon: <Smartphone className="h-3.5 w-3.5" /> },
];

/**
 * The "you'll never get an answer without knowing where it came from" panel.
 * Clicking a citation opens the originating source here with the exact
 * cited chunk scrolled into view and highlighted — a PDF page, a transcript
 * span with its timestamp, a text passage, a live/embedded web page, or
 * a screenshot snapshot of a non-embeddable site.
 */
export function StudioPanel({
  citation,
  onClose,
  notebookId,
}: {
  citation: Citation | null;
  onClose: () => void;
  notebookId?: string;
}) {
  const [data, setData] = useState<SourceContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  /** WEB/URL viewer state */
  const [webPreview, setWebPreview] = useState<WebPreviewResult | null>(null);
  const [webLoading, setWebLoading] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);

  /** Web viewer display state */
  const [viewMode, setViewMode] = useState<ViewMode>("desktop");
  const [displayMode, setDisplayMode] = useState<"live" | "reader">("live");
  const [bannerReason, setBannerReason] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const isWebSource =
    citation?.sourceType === "WEB" || citation?.sourceType === "URL";
  const previewUrl = isWebSource
    ? ((citation?.sourceType === "WEB"
        ? citation?.url
        : data?.source.originUrl) ?? null)
    : null;

  const finalSrc = isWebSource
    ? (webPreview?.finalUrl ?? previewUrl ?? null)
    : null;
  const isMixedContent = !!finalSrc && finalSrc.startsWith("http://");
  const embeddabilityBlocksIframe =
    isWebSource && (webPreview?.embeddable === false || isMixedContent);
  const isReader = displayMode === "reader" || !!embeddabilityBlocksIframe;
  const hostname = previewUrl
    ? (() => {
        try {
          return new URL(previewUrl).hostname;
        } catch {
          return undefined;
        }
      })()
    : undefined;

  useEffect(() => {
    if (!citation) return;
    setError(null);
    // WEB citations have no sourceId — skip the source-content fetch.
    if (citation.sourceType === "WEB") return;

    setLoading(true);
    setData(null);
    fetch(
      `/api/sources/${citation.sourceId}/content?chunkId=${citation.chunkId}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load source content");
        return r.json();
      })
      .then((d) => {
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [citation]);

  // Fetch embeddability for WEB/URL citations once we have a URL.
  useEffect(() => {
    if (!isWebSource || !previewUrl) return;
    setWebPreview(null);
    setWebLoading(true);
    setWebError(null);
    fetch(`/api/web-preview?url=${encodeURIComponent(previewUrl)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to check embeddability");
        return r.json();
      })
      .then((d) => setWebPreview(d))
      .catch((e) => setWebError(e.message))
      .finally(() => setWebLoading(false));
  }, [citation, isWebSource, previewUrl, data]);

  // Scroll to the highlighted paragraph / chunk when data or web preview changes.
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [data, webPreview]);

  // Restore per-notebook viewer preferences.
  useEffect(() => {
    if (!notebookId) return;
    try {
      const savedMode = localStorage.getItem(`webviewer-view:${notebookId}`);
      if (savedMode === "desktop" || savedMode === "tablet" || savedMode === "mobile") {
        setViewMode(savedMode);
      }
      const savedDisplay = localStorage.getItem(`webviewer-display:${notebookId}`);
      if (savedDisplay === "live" || savedDisplay === "reader") {
        setDisplayMode(savedDisplay);
      }
    } catch {}
  }, [notebookId]);

  useEffect(() => {
    if (!notebookId) return;
    try {
      localStorage.setItem(`webviewer-view:${notebookId}`, viewMode);
      localStorage.setItem(`webviewer-display:${notebookId}`, displayMode);
    } catch {}
  }, [viewMode, displayMode, notebookId]);

  // HTTP pages can't be framed securely -> force reader + banner.
  useEffect(() => {
    if (!isWebSource) return;
    if (isMixedContent) {
      setDisplayMode("reader");
      setBannerReason("Site is HTTP and can't be embedded");
    }
  }, [isMixedContent, isWebSource]);

  const handleDisplayModeChange = useCallback(
    (mode: "live" | "reader") => {
      if (mode === "live" && embeddabilityBlocksIframe) return;
      setDisplayMode(mode);
    },
    [embeddabilityBlocksIframe],
  );

  const handleSlowBanner = useCallback(() => {
    setBannerReason("Taking a while. Open in new tab / Reader view.");
  }, []);

  const handleReload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  const openWithFragment = useCallback(() => {
    if (!finalSrc) return;
    window.open(finalSrc + textHashFragment(citation?.snippet ?? ""), "_blank", "noopener,noreferrer");
  }, [finalSrc, citation?.snippet]);

  const retryLoad = useCallback(() => {
    if (!citation) return;
    if (isWebSource && previewUrl) {
      setWebLoading(true);
      setWebError(null);
      fetch(`/api/web-preview?url=${encodeURIComponent(previewUrl)}&bypass=true`)
        .then((r) => {
          if (!r.ok) throw new Error("Failed to check embeddability");
          return r.json();
        })
        .then((d) => setWebPreview(d))
        .catch((e) => setWebError(e.message))
        .finally(() => setWebLoading(false));
    } else if (citation.sourceId) {
      setLoading(true);
      setError(null);
      fetch(
        `/api/sources/${citation.sourceId}/content?chunkId=${citation.chunkId}`,
      )
        .then((r) => {
          if (!r.ok) throw new Error("Failed to load source content");
          return r.json();
        })
        .then((d) => setData(d))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [citation, isWebSource, previewUrl]);

  if (!citation) return null;

  return (
    <div className="flex h-full flex-col" data-testid="citation-viewer">
      <div className="flex h-full w-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3" data-testid="source-viewer-header">
          <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FileSearch className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Source viewer</span>
            <Badge variant="secondary" className="text-[10px] capitalize">
              {citation.sourceType.toLowerCase()}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            aria-label="Close source viewer"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
            {/* === WEB / URL viewer === */}
            {isWebSource ? (
              <>
                {webLoading && (
                  <div className="flex h-full items-center justify-center p-4">
                    <div className="text-center space-y-2">
                      <div className="flex justify-center gap-1">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="h-2 w-2 rounded-full bg-primary animate-pulse"
                            style={{ animationDelay: `${i * 100}ms` }}
                          />
                        ))}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Loading preview…
                      </p>
                    </div>
                  </div>
                )}

                {webError && (
                  <div className="flex h-full items-center justify-center p-4">
                    <Empty
                      icon={<WifiOff className="h-8 w-8" />}
                      title="Could not load preview"
                      description={webError}
                      action={
                        <Button variant="outline" size="sm" onClick={retryLoad}>
                          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
                        </Button>
                      }
                    />
                  </div>
                )}

                {previewUrl && webPreview !== null && (
                  <div className="flex h-full min-h-0 min-w-0 flex-col">
                    <WebViewerToolbar
                      viewMode={viewMode}
                      displayMode={displayMode}
                      isReader={isReader}
                      embeddable={webPreview.embeddable}
                      hostname={hostname}
                      bannerReason={bannerReason}
                      onModeChange={setViewMode}
                      onDisplayModeChange={handleDisplayModeChange}
                      onReload={handleReload}
                      onOpenInNewTab={openWithFragment}
                    />
                    <div
                      className="relative min-h-0 flex-1"
                      data-testid="web-viewer-body"
                    >
                      {isReader ? (
                        <ScrollArea className="h-full w-full">
                          <div className="p-4">
                            {webPreview.title && (
                              <h3 className="mb-3 font-sans text-sm font-semibold text-foreground">
                                {webPreview.title}
                              </h3>
                            )}
                            {webPreview.text ? (
                              <ReaderParagraphs
                                text={webPreview.text}
                                snippet={citation.snippet}
                                highlightRef={highlightRef}
                              />
                            ) : citation.snippet ? (
                              <div className="rounded-sm bg-accent/20 px-1 py-0.5 font-sans text-sm leading-6">
                                {citation.snippet}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                No readable text was extracted from this page.
                              </p>
                            )}
                          </div>
                        </ScrollArea>
                      ) : (
                        <ScaledIframe
                          src={finalSrc ?? previewUrl}
                          title={citation.sourceTitle}
                          mode={viewMode}
                          reloadKey={reloadKey}
                          onSlow={handleSlowBanner}
                        />
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : error ? (
              <div className="flex h-full items-center justify-center p-4">
                <Empty
                  icon={<AlertCircle className="h-8 w-8" />}
                  title="Failed to load source"
                  description={error}
                  action={
                    <Button variant="outline" size="sm" onClick={retryLoad}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
                    </Button>
                  }
                />
              </div>
            ) : loading ? (
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </ScrollArea>
            ) : data &&
              data.source.type === "PDF" &&
              data.source.hasFile &&
              citation.page != null ? (
              <div className="flex-1 min-h-0">
                <PdfViewer
                  sourceId={citation.sourceId}
                  page={citation.page}
                  highlight={
                    data.chunks.find((c) => c.id === citation.chunkId)?.content
                  }
                />
              </div>
            ) : data ? (
              <ScrollArea className="flex-1">
                <div className="p-4">
                  {data.source.type === "PDF" && !data.source.hasFile && (
                    <div className="mb-3 rounded-md bg-amber-50/20 px-3 py-2 text-xs text-amber-600 border border-amber-500/20">
                      Original PDF isn't stored for this source. Re-upload it to
                      see the real page.
                    </div>
                  )}

                  {data.source.type === "YOUTUBE" &&
                  data.source.metadata?.videoId ? (
                    <>
                      <SourceHeader source={data.source} />
                      <YoutubeEmbed
                        videoId={data.source.metadata.videoId}
                        startSec={citation.startSec ?? 0}
                        title={data.source.title}
                      />
                    </>
                  ) : (
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
                                isHighlighted
                                  ? "border-primary/50 bg-primary/10"
                                  : "border-transparent",
                              )}
                            >
                              {(c.page != null || c.startSec != null) && (
                                <div className="mb-1 font-sans text-[10px] uppercase tracking-wide text-muted-foreground">
                                  {c.page != null
                                    ? `Page ${c.page}`
                                    : `${formatTimestamp(c.startSec!)} – ${formatTimestamp(c.endSec ?? 0)}`}
                                </div>
                              )}
                              <p className="whitespace-pre-wrap text-foreground">
                                {c.content}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </ScrollArea>
            ) : null}
          </div>
        </div>
      </div>
  );
}

function WebViewerToolbar({
  viewMode,
  displayMode,
  isReader,
  embeddable,
  hostname,
  bannerReason,
  onModeChange,
  onDisplayModeChange,
  onReload,
  onOpenInNewTab,
}: {
  viewMode: ViewMode;
  displayMode: "live" | "reader";
  isReader: boolean;
  embeddable: EmbeddableResult;
  hostname?: string;
  bannerReason: string | null;
  onModeChange: (mode: ViewMode) => void;
  onDisplayModeChange: (mode: "live" | "reader") => void;
  onReload: () => void;
  onOpenInNewTab: () => void;
}) {
  const liveDisabled = embeddable === false;
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-2 scrollbar-thin"
      data-testid="web-viewer-toolbar"
      role="toolbar"
      aria-label="Web viewer"
    >
      {/* Left: device segmented control (icon-only below sm) */}
      <div
        className="flex items-center gap-0.5"
        role="radiogroup"
        aria-label="Device preview"
      >
        {DEVICE_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onModeChange(m.id)}
            disabled={isReader}
            title={m.label}
            className={cn(
              "flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              viewMode === m.id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              isReader && "opacity-60",
            )}
          >
            {m.icon}
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        ))}
      </div>

      {/* Middle: Live / Reader (Reader is the text view; replaces the old Text button) */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => onDisplayModeChange("live")}
          disabled={liveDisabled}
          title="Live site"
          className={cn(
            "flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
            displayMode === "live"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
            liveDisabled && "opacity-60",
          )}
        >
          Live
        </button>
        <button
          type="button"
          onClick={() => onDisplayModeChange("reader")}
          title="Reader"
          className={cn(
            "flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
            displayMode === "reader"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
          )}
        >
          Reader
        </button>
      </div>

      {/* Non-blocking status banner */}
      {bannerReason && (
        <span
          className="max-w-[140px] truncate text-xs text-muted-foreground"
          title={bannerReason}
        >
          {bannerReason}
        </span>
      )}

      {/* Right (pinned): hostname, reload, open in new tab */}
      <div className="ml-auto flex items-center gap-0.5 shrink-0">
        {hostname && (
          <span
            className="max-w-[140px] truncate text-xs text-muted-foreground"
            title={hostname}
          >
            {hostname}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onReload}
          aria-label="Reload"
          title="Reload"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onOpenInNewTab}
          aria-label="Open in new tab"
          title="Open in new tab"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
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
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const snippetNorm = snippet.trim().toLowerCase();
  const firstWords = snippetNorm.split(/\s+/).slice(0, 8).join(" ");

  const matchScore = (para: string): number => {
    const paraNorm = para.toLowerCase();
    if (!snippetNorm) return 0;
    if (paraNorm.includes(snippetNorm)) return 3;
    if (paraNorm.includes(firstWords) && firstWords.length > 10) return 2;
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
    <div className="space-y-4">
      {paragraphs.map((para, i) => {
        const score = matchScore(para);
        const isHighlighted = score >= 2;
        const isFirstHighlight =
          !firstHighlightSet && score >= 2 && (firstHighlightSet = true);
        return (
          <p
            key={i}
            ref={isFirstHighlight ? highlightRef : undefined}
            className={cn(
              "text-foreground",
              isHighlighted && "bg-accent/20 rounded-sm px-0.5",
            )}
          >
            {para}
          </p>
        );
      })}
    </div>
  );
}

function YoutubeEmbed({
  videoId,
  startSec,
  title,
}: {
  videoId: string;
  startSec: number;
  title: string;
}) {
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
  hi: "Hindi",
  es: "Spanish",
  fr: "French",
  de: "German",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ar: "Arabic",
  pt: "Portuguese",
  ru: "Russian",
  it: "Italian",
  ta: "Tamil",
  te: "Telugu",
  bn: "Bengali",
  mr: "Marathi",
  gu: "Gujarati",
  pa: "Punjabi",
  ur: "Urdu",
};

function SourceHeader({ source }: { source: SourceContent["source"] }) {
  const Icon = sourceTypeIcon[source.type];
  const lang = source.language;
  const langName =
    lang && lang !== "en" ? (LANGUAGE_NAMES[lang] ?? lang.toUpperCase()) : null;
  return (
    <div className="flex items-start gap-2 border-b border-border pb-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <h4 className="truncate font-display text-sm font-semibold">
          {source.title}
        </h4>
        <p className="text-[11px] text-muted-foreground">
          {source.pageCount
            ? `${source.pageCount} pages`
            : source.durationSec
              ? formatTimestamp(source.durationSec) + " total"
              : "Text source"}
        </p>
        {langName && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Translated to English from {langName}
          </p>
        )}
      </div>
    </div>
  );
}
