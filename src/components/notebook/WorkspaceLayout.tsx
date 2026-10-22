"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, GraduationCap, Headphones, Map, MessageSquare, PanelLeft, StickyNote } from "lucide-react";
import type { StudioTabId } from "@/components/studio/StudioTabs";

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
  /** Which studio tab is currently showing (used to highlight the mobile nav). */
  activeTab?: StudioTabId | null;
}

const DESKTOP_QUERY = "(min-width: 1024px)";

const TABS: { id: StudioTabId; label: string; icon: typeof Headphones }[] = [
  { id: "audio", label: "Audio", icon: Headphones },
  // { id: "roadmap", label: "Roadmap", icon: Map },
  { id: "study", label: "Study", icon: GraduationCap },
  { id: "notes", label: "Notes", icon: StickyNote },
];

function NavButton({ icon: Icon, label, active, onClick }: { icon: typeof Headphones; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium transition-colors",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-primary/15")}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
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
  focusMode,
  children,
  onTabSelect,
  activeTab = null,
}: WorkspaceLayoutProps) {
  const [isMobile, setIsMobile] = useState(false);

  // Keep the latest callbacks in refs so effects don't re-run on every render.
  const cbRef = useRef({ onSourcesOpenChange, onRightOpenChange });
  useEffect(() => {
    cbRef.current = { onSourcesOpenChange, onRightOpenChange };
  });

  // Restore the saved sources state on desktop only (a saved "open" must not pop a sheet on a phone).
  useEffect(() => {
    try {
      if (!window.matchMedia(DESKTOP_QUERY).matches) return;
      const saved = localStorage.getItem("notebook-sources-open");
      if (saved !== null) cbRef.current.onSourcesOpenChange(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  // Persist only the desktop preference.
  useEffect(() => {
    if (isMobile) return;
    try {
      localStorage.setItem("notebook-sources-open", JSON.stringify(sourcesOpen));
    } catch {
      // ignore
    }
  }, [sourcesOpen, isMobile]);

  // Track the breakpoint. When we first land on mobile, start with both sheets closed.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const apply = (initial: boolean) => {
      const mobile = !mq.matches;
      setIsMobile((prev) => {
        if (mobile && (initial || !prev)) {
          cbRef.current.onSourcesOpenChange(false);
          cbRef.current.onRightOpenChange(false);
        }
        return mobile;
      });
    };
    apply(true);
    const onChange = () => apply(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Keyboard shortcuts (desktop): Esc closes panels, Cmd/Ctrl+B toggles sources.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isMobile) {
        if (rightOpen) onRightOpenChange(false);
        else if (sourcesOpen) onSourcesOpenChange(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        onSourcesOpenChange(!sourcesOpen);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sourcesOpen, rightOpen, isMobile, onSourcesOpenChange, onRightOpenChange]);

  const showSources = !focusMode && sourcesOpen;
  const showRight = !focusMode && rightOpen;

  // Desktop grid: sources 260px | chat (min 520px) | right panel
  const rightColWidth = rightPanelKind === "viewer" ? "clamp(560px, 42vw, 720px)" : "clamp(380px, 30vw, 480px)";
  const cols = `${showSources ? "260px" : "0"} minmax(520px, 1fr) ${showRight ? rightColWidth : "0"}`;

  return (
    <div data-testid="workspace-layout" className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      {/* ONE layout for every screen size: a column on phones, a 3-column grid on desktop.
          The chat panel is mounted exactly once. */}
      <div
        className="flex min-h-0 flex-1 flex-col lg:grid lg:overflow-hidden lg:[grid-template-columns:var(--ws-cols)]"
        style={{ "--ws-cols": cols } as React.CSSProperties}
      >
        <aside
          data-testid="sources-panel"
          className="hidden min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-card/40 transition-all duration-200 motion-reduce:transition-none lg:flex"
        >
          {!isMobile && showSources && sourcesPanel}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="chat-column">
          {chatPanel}
        </main>

        <aside
          data-testid="right-panel"
          className="hidden min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-card/40 transition-all duration-200 motion-reduce:transition-none lg:flex"
        >
          {!isMobile && showRight && rightPanel}
        </aside>
      </div>

      {/* Mobile / tablet bottom navigation */}
      {!focusMode && (
        <nav
          aria-label="Workspace sections"
          className="shrink-0 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        >
          <div className="grid grid-cols-6">
            <NavButton icon={PanelLeft} label="Sources" active={sourcesOpen} onClick={() => onSourcesOpenChange(!sourcesOpen)} />
            <NavButton
              icon={MessageSquare}
              label="Chat"
              active={!sourcesOpen && !rightOpen}
              onClick={() => {
                onSourcesOpenChange(false);
                onRightOpenChange(false);
              }}
            />
            {TABS.map((t) => {
              const active = rightOpen && activeTab === t.id;
              return (
                <NavButton
                  key={t.id}
                  icon={t.icon}
                  label={t.label}
                  active={active}
                  onClick={() => {
                    onSourcesOpenChange(false);
                    if (active) onRightOpenChange(false);
                    else onTabSelect?.(t.id);
                  }}
                />
              );
            })}
          </div>
        </nav>
      )}

      {/* Mobile sheets: controlled directly by the shared state, so they can never get out of sync */}
      <Sheet open={isMobile && showSources} onOpenChange={onSourcesOpenChange}>
        <SheetContent side="left" className="h-full w-[88vw] max-w-[340px] p-0">
          <div className="flex h-full min-h-0 w-full flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-border p-3">
              <span className="font-medium">Sources</span>
              <Button variant="ghost" size="icon" onClick={() => onSourcesOpenChange(false)} aria-label="Close sources">
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{sourcesPanel}</div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={isMobile && showRight} onOpenChange={onRightOpenChange}>
        <SheetContent side="right" className="h-full w-full max-w-full p-0 sm:max-w-[560px]">
          <div className="flex h-full min-h-0 w-full flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-border p-3">
              <span className="font-medium">Studio</span>
              <Button variant="ghost" size="icon" onClick={() => onRightOpenChange(false)} aria-label="Close studio">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{rightPanel}</div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Dialogs, command palette, etc. */}
      {children}
    </div>
  );
}