"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, X } from "lucide-react";
import { StudioTabs, type StudioTabId } from "@/components/studio/StudioTabs";

type RightPanelKind =
  | null
  | { kind: "citation"; citation: { sourceId: string; chunkId: string; page?: number | null; snippet?: string; sourceTitle?: string; sourceType: string; url?: string; marker?: number } }
  | { kind: "audio" }
  // | { kind: "roadmap" }
  | { kind: "study" }
  | { kind: "notes" };

interface RightPanelProps {
  panel: RightPanelKind;
  onClose: () => void;
  onTabSelect: (tab: StudioTabId) => void;
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  badge?: React.ReactNode;
  headerActions?: React.ReactNode;
}

function getTabInfo(kind: StudioTabId): { icon: string; label: string } {
  switch (kind) {
    case "audio": return { icon: "🎧", label: "Audio" };
    // case "roadmap": return { icon: "🗺️", label: "Roadmap" };
    case "study": return { icon: "📚", label: "Study" };
    case "notes": return { icon: "📝", label: "Notes" };
    default: return { icon: "", label: "Studio" };
  }
}

export function RightPanel({
  panel,
  onClose,
  onTabSelect,
  children,
  title,
  subtitle,
  badge,
  headerActions,
}: RightPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  // Handle escape key to close panel
  useEffect(() => {
    if (!panel) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panel, onClose]);

  // Focus management when panel opens
  useEffect(() => {
    if (panel && panelRef.current) {
      const closeBtn = panelRef.current.querySelector('[data-close-btn]') as HTMLElement;
      closeBtn?.focus();
    }
  }, [panel]);

  if (!panel) return null;

  const isCitation = panel.kind === "citation";
  const activeTab = !isCitation ? panel.kind as StudioTabId : null;
  const tabInfo = isCitation ? { icon: "📄", label: "Source viewer" } : activeTab ? getTabInfo(activeTab) : { icon: "", label: "Studio" };

  return (
    <div
      ref={panelRef}
      className="flex h-full flex-col min-w-0"
      data-testid="right-panel-content"
      data-panel-kind={isCitation ? "viewer" : "tabs"}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-lg shrink-0" aria-hidden="true">{tabInfo.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-medium text-muted-foreground">{title ?? tabInfo.label}</span>
              {badge && <span className="shrink-0">{badge}</span>}
            </div>
            {subtitle && (
              <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {headerActions}
          {!isCitation && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={onClose}
                aria-label="Close panel"
                data-close-btn
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {isCitation && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => window.open(`/api/sources/${panel.citation.sourceId}/file`, "_blank")}
                title="Open in new tab"
                aria-label="Open in new tab"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  const link = document.createElement("a");
                  link.href = `/api/sources/${panel.citation.sourceId}/file`;
                  link.download = `${panel.citation.sourceTitle || "source"}.pdf`;
                  link.click();
                }}
                title="Download"
                aria-label="Download"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={onClose}
                aria-label="Close viewer"
                data-close-btn
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tab Strip (only for tabs panels, not citation viewer) */}
      {!isCitation && (
        <div
          ref={tabsRef}
          className="flex items-center gap-1 border-b border-border bg-secondary/10 px-2 py-1.5 overflow-x-auto scrollbar-thin"
          role="tablist"
          aria-label="Studio panels"
        >
          <StudioTabs active={activeTab as StudioTabId} onSelect={onTabSelect} />
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1">
        {isCitation ? (
          <div className="h-full w-full">{children}</div>
        ) : (
          <div className="h-full">
            <ScrollArea className="h-full">
              <div className="p-4">{children}</div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}

export type { RightPanelKind };