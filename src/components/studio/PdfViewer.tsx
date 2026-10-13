"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const Spinner = () => <Loader2 className="h-5 w-5 animate-spin text-primary" />;

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
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
  const [containerWidth, setContainerWidth] = useState(0);

  const outerRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);

  // "Start at page, and jump again whenever the page or sourceId prop
  // changes." Layout effect so the correct page paints immediately.
  useLayoutEffect(() => {
    setCurrentPage(page);
    setError(null);
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

  const normalizedHighlight = useMemo(() => (highlight ?? "").replace(/\s/g, "").toLowerCase(), [highlight]);

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
    [normalizedHighlight]
  );

  const goPrev = () => setCurrentPage((p) => Math.max(1, p - 1));
  const goNext = () => setCurrentPage((p) => Math.min(numPages, p + 1));

  const canPrev = currentPage > 1;
  const canNext = numPages > 0 && currentPage < numPages;

  return (
    <div ref={outerRef} className="flex h-full w-full flex-col overflow-y-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={goPrev} disabled={!canPrev || !!error} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goNext} disabled={!canNext || !!error} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-xs font-mono text-muted-foreground">
          Page {numPages > 0 ? currentPage : "—"} / {numPages}
        </span>
        <a
          href={`/api/sources/${sourceId}/file#page=${currentPage}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground opacity-70 hover:opacity-100 hover:text-foreground"
          aria-label="Open original in new tab"
          title="Open original in new tab"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div ref={resizeRef} className="flex-1 overflow-auto">
        {error ? (
          <div className="p-4 text-center text-sm text-destructive">{error}</div>
        ) : (
          <Document
            key={sourceId}
            file={`/api/sources/${sourceId}/file`}
            loading={<div className="py-8 text-center"><Spinner /></div>}
            error={<div className="py-4 text-center text-sm text-destructive">{error ?? "Failed to load PDF"}</div>}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentError}
            noData="No PDF specified."
            suspense={false}
            renderMode="canvas"
          >
            {containerWidth > 0 &&
              (numPages > 0 ? (
                <Page
                  key={`${sourceId}-${currentPage}`}
                  pageNumber={currentPage}
                  width={containerWidth}
                  loading={<div className="py-8 text-center"><Spinner /></div>}
                  error={<div className="py-4 text-center text-sm text-destructive">Failed to render page</div>}
                  customTextRenderer={customTextRenderer}
                  renderTextLayer
                  renderAnnotationLayer
                  suspense={false}
                />
              ) : (
                <div className="py-8 text-center"><Spinner /></div>
              ))}
          </Document>
        )}
      </div>
    </div>
  );
}
