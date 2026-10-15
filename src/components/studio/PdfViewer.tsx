"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Minus, Plus, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const Spinner = () => <Loader2 className="h-5 w-5 animate-spin text-primary" />;

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => {
    if (c === "&") return "&";
    if (c === "<") return "<";
    if (c === ">") return ">";
    if (c === '"') return '"';
    return "'";
  });
}

export type PdfViewerProps = {
  sourceId: string;
  page: number;
  highlight?: string;
};

/**
 * Renders the original uploaded PDF (streamed through the `/file` route) at
 * the cited page, with the cited chunk's text fragment highlighted inline.
 *
 * Loaded with `ssr: false` by StudioPanel because pdf.js needs browser APIs
 * (the worker, canvas, etc.) that aren't present at build time.
 */
export function PdfViewer({ sourceId, page, highlight }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(page);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);
  const [hasHighlightScrolled, setHasHighlightScrolled] = useState(false);

  const outerRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // Start at page, and jump again whenever the page or sourceId prop changes.
  useLayoutEffect(() => {
    setCurrentPage(page);
    setError(null);
    setHasHighlightScrolled(false);
  }, [page, sourceId]);

  // Scroll the PDF viewport back to the top on every page turn.
  useEffect(() => {
    if (outerRef.current) {
      outerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentPage]);

  // Fit the rendered page to its container width via ResizeObserver.
  useLayoutEffect(() => {
    const el = resizeRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onDocumentLoadSuccess = (pdf: { numPages: number }) => {
    setNumPages(pdf.numPages);
    setError(null);
  };
  const onDocumentError = (err: Error | null) => {
    setError(err?.message ?? "Failed to load PDF");
  };

  const normalizedHighlight = useMemo(
    () => (highlight ?? "").replace(/\s/g, "").toLowerCase(),
    [highlight],
  );

  const customTextRenderer = useCallback(
    ({ str }: { str?: string }) => {
      const text = str ?? "";
      const escaped = escapeHtml(text);
      if (normalizedHighlight) {
        const fragment = text.replace(/\s/g, "").toLowerCase();
        if (fragment.length >= 10 && normalizedHighlight.includes(fragment)) {
          return `<mark class="pdf-cite-highlight">${escaped}</mark>`;
        }
      }
      return escaped;
    },
    [normalizedHighlight],
  );

  const goPrev = () => setCurrentPage((p) => Math.max(1, p - 1));
  const goNext = () => setCurrentPage((p) => Math.min(numPages, p + 1));

  const canPrev = currentPage > 1;
  const canNext = numPages > 0 && currentPage < numPages;

  const handleZoomIn = () => {
    setFitWidth(false);
    setScale((s) => Math.min(s * 1.2, 3));
  };
  const handleZoomOut = () => {
    setFitWidth(false);
    setScale((s) => Math.max(s / 1.2, 0.3));
  };
  const handleFitWidth = () => {
    setFitWidth(true);
  };

  const handlePageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= numPages) {
      setCurrentPage(val);
    }
  };

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  // Scroll highlight into view after text layer renders
  useEffect(() => {
    if (hasHighlightScrolled) return;
    const pageEl = pageRef.current;
    if (!pageEl) return;
    const highlight = pageEl.querySelector(".pdf-cite-highlight");
    if (highlight) {
      highlight.scrollIntoView({ block: "center" });
      setHasHighlightScrolled(true);
    }
  }, [currentPage, containerWidth]);

  // Page width: if fitWidth, use container width (clamped); else use scale * base width
  const pageWidth = useMemo(() => {
    if (fitWidth && containerWidth > 0) {
      return Math.min(containerWidth - 24, 900);
    }
    return undefined; // let react-pdf use default when scaling
  }, [fitWidth, containerWidth]);

  const canFitWidth = containerWidth > 0;

  return (
    <div
      ref={outerRef}
      className="flex h-full w-full flex-col overflow-y-hidden"
    >
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={goPrev}
            disabled={!canPrev || !!error}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={goNext}
            disabled={!canNext || !!error}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <form onSubmit={handlePageSubmit} className="flex items-center gap-1">
            <Input
              type="number"
              value={currentPage}
              onChange={handlePageInput}
              min={1}
              max={numPages}
              className="w-[50px] text-center text-xs font-mono"
              disabled={!!error}
            />
            <span className="text-xs text-muted-foreground">/ {numPages}</span>
          </form>
          <div className="flex items-center gap-1 ml-2 border-l border-border pl-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleZoomOut}
              disabled={!!error}
              aria-label="Zoom out"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleZoomIn}
              disabled={!!error}
              aria-label="Zoom in"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant={fitWidth ? "default" : "ghost"}
              size="sm"
              onClick={handleFitWidth}
              disabled={!!error || !canFitWidth}
              aria-label="Fit width"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
          <a
            href={`/api/sources/${sourceId}/file#page=${currentPage}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Open original in new tab"
            title="Open original in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <div ref={resizeRef} className="flex-1 overflow-auto p-4">
        {error ? (
          <div className="p-4 text-center text-sm text-destructive">
            {error}
          </div>
        ) : (
          <Document
            key={sourceId}
            file={`/api/sources/${sourceId}/file`}
            loading={
              <div className="py-8 text-center">
                <Spinner />
              </div>
            }
            error={
              <div className="py-4 text-center text-sm text-destructive">
                {error ?? "Failed to load PDF"}
              </div>
            }
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentError}
            noData="No PDF specified."
            suspense={false}
            renderMode="canvas"
          >
            {(containerWidth > 0 || !fitWidth) && numPages > 0 ? (
              <Page
                key={`${sourceId}-${currentPage}`}
                pageNumber={currentPage}
                width={pageWidth}
                scale={fitWidth ? undefined : scale}
                loading={
                  <div className="py-8 text-center">
                    <Spinner />
                  </div>
                }
                error={
                  <div className="py-4 text-center text-sm text-destructive">
                    Failed to render page
                  </div>
                }
                customTextRenderer={customTextRenderer}
                renderTextLayer
                renderAnnotationLayer
                suspense={false}
              />
            ) : (
              <div className="py-8 text-center">
                <Spinner />
              </div>
            )}
          </Document>
        )}
      </div>
    </div>
  );
}