"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PanelLeft, PanelRight, ChevronLeft, ChevronRight } from "lucide-react";
import { StudioTabs, type StudioTabId } from "@/components/studio/StudioTabs";

interface WorkspaceLayoutProps {
  sourcesPanel: React.ReactNode;
  chatPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  sourcesOpen: boolean;
  onSourcesOpenChange: (open: boolean) => void;
  rightOpen: boolean;
  onRightOpenChange: (open: boolean) => void;
  rightPanelKind: "tabs" | "viewer" | null;
  onRightPanelKindChange: (kind: "tabs" | "viewer" | null) => void;
  focusMode: boolean;
  onFocusModeChange: (focus: boolean) => void;
  children?: React.ReactNode;
  onTabSelect?: (tab: StudioTabId) => void;
}

export function WorkspaceLayout({
  sourcesPanel,
  chatPanel,
  rightPanel,
  sourcesOpen,
  onSourcesOpenChange,
  rightOpen,
  onRightOpenChange,
  rightPanelKind,
  onRightPanelKindChange,
  focusMode,
  onFocusModeChange,
  children,
  onTabSelect,
}: WorkspaceLayoutProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [sourcesSheetOpen, setSourcesSheetOpen] = useState(false);
  const [rightSheetOpen, setRightSheetOpen] = useState(false);

  // Persist sources open/closed in localStorage (no hydration flash)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("notebook-sources-open");
      if (saved !== null) {
        onSourcesOpenChange(JSON.parse(saved));
      }
    } catch {
      // ignore
    }
  }, [onSourcesOpenChange]);

  useEffect(() => {
    try {
      localStorage.setItem("notebook-sources-open", JSON.stringify(sourcesOpen));
    } catch {
      // ignore
    }
  }, [sourcesOpen]);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Sync sheet states when mobile
  useEffect(() => {
    if (isMobile) {
      setSourcesSheetOpen(sourcesOpen);
      setRightSheetOpen(rightOpen);
    }
  }, [isMobile, sourcesOpen, rightOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isMobile) {
          if (sourcesSheetOpen) setSourcesSheetOpen(false);
          if (rightSheetOpen) setRightSheetOpen(false);
        } else {
          if (rightOpen) onRightOpenChange(false);
          else if (sourcesOpen) onSourcesOpenChange(false);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        onSourcesOpenChange(!sourcesOpen);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sourcesOpen, rightOpen, isMobile, sourcesSheetOpen, rightSheetOpen, onSourcesOpenChange, onRightOpenChange]);

  const showSources = !focusMode && sourcesOpen;
  const showRight = !focusMode && rightOpen;

  // Calculate grid template columns
  // Sources: 260px or 0
  // Chat: minmax(520px, 1fr)
  // Right: viewer kind = 560px, tabs kind = 480px
  const sourcesCol = !focusMode && showSources ? "260px" : "0";
  const chatCol = "minmax(520px, 1fr)";
  const rightColWidth =
    rightPanelKind === "viewer"
      ? "clamp(560px, 42vw, 720px)"
      : "clamp(380px, 30vw, 480px)";
  const rightCol = !focusMode && showRight ? rightColWidth : "0";

  return (
    <div
      data-testid="workspace-layout"
      className="flex h-full w-full flex-col min-h-0 overflow-hidden"
    >
      {/* Desktop Grid Layout */}
      <div
        className="hidden lg:grid lg:min-h-0 lg:flex-1 lg:overflow-hidden"
        style={{
          gridTemplateColumns: `${sourcesCol} ${chatCol} ${rightCol}`,
        }}
      >
        {/* Sources Rail */}
        <aside
          data-testid="sources-panel"
          className={cn(
            "min-w-0 overflow-hidden border-r border-border bg-card/40 transition-all duration-200 motion-reduce:transition-none",
            showSources ? "flex flex-col" : "w-0 overflow-hidden"
          )}
        >
          {showSources && sourcesPanel}
        </aside>

        {/* Chat Panel */}
        <main className="min-w-0 overflow-hidden flex flex-col" data-testid="chat-column">
          {chatPanel}
        </main>

        {/* Right Panel */}
        <aside
          data-testid="right-panel"
          className={cn(
            "min-w-0 overflow-hidden border-l border-border bg-card/40 transition-all duration-200 motion-reduce:transition-none",
            showRight ? "flex h-full min-h-0 flex-col" : "w-0 overflow-hidden",
          )}
        >
          {showRight && rightPanel}
        </aside>
      </div>

      {/* Mobile: Tab bar at bottom */}
      <div className="lg:hidden border-t border-border bg-card/80">
        <div className="flex overflow-x-auto scrollbar-thin px-2 py-1.5 gap-1">
          <Button
            variant={sourcesOpen ? "default" : "outline"}
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => setSourcesSheetOpen(!sourcesSheetOpen)}
            aria-pressed={sourcesOpen}
          >
            <PanelLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sources</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            disabled
          >
            <span className="hidden sm:inline">Chat</span>
          </Button>
          <Button
            variant={rightOpen ? "default" : "outline"}
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => setRightSheetOpen(!rightSheetOpen)}
            aria-pressed={rightOpen}
          >
            <PanelRight className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Studio</span>
          </Button>
        </div>
      </div>

      {/* Mobile Sheets */}
      <Sheet open={sourcesSheetOpen} onOpenChange={setSourcesSheetOpen}>
        <SheetContent side="left" className="h-full w-[85vw] max-w-[320px] p-0">
          <div className="flex h-full w-full flex-col">
            <div className="flex items-center justify-between border-b border-border p-3">
              <span className="font-medium">Sources</span>
              <Button variant="ghost" size="icon" onClick={() => setSourcesSheetOpen(false)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto">{sourcesPanel}</div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
        <SheetContent side="right" className="h-full w-[90vw] max-w-[560px] p-0">
          <div className="flex h-full w-full flex-col">
            <div className="flex items-center justify-between border-b border-border p-3">
              <span className="font-medium">Studio</span>
              <Button variant="ghost" size="icon" onClick={() => setRightSheetOpen(false)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto">{rightPanel}</div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Children (dialogs, command palette, etc) */}
      {children}
    </div>
  );
}