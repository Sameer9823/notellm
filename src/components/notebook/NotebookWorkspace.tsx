"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LayoutPanelLeft, LayoutPanelTop, LayoutGrid, PanelLeft, PanelRight, Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

interface NotebookWorkspaceProps {
  sourcesPanel: React.ReactNode;
  chatPanel: React.ReactNode;
  studioPanel: React.ReactNode;
  sourcesOpen?: boolean;
  onSourcesOpenChange?: (open: boolean) => void;
  studioOpen?: boolean;
  onStudioOpenChange?: (open: boolean) => void;
  focusMode?: boolean;
  onFocusModeChange?: (focus: boolean) => void;
}

export function NotebookWorkspace({
  sourcesPanel,
  chatPanel,
  studioPanel,
  sourcesOpen = true,
  onSourcesOpenChange,
  studioOpen = true,
  onStudioOpenChange,
  focusMode = false,
  onFocusModeChange,
}: NotebookWorkspaceProps) {
  const [mobileTab, setMobileTab] = useState<string>("chat");
  const [sourcesSheetOpen, setSourcesSheetOpen] = useState(false);
  const [studioSheetOpen, setStudioSheetOpen] = useState(false);

  // Persist panel sizes
  useEffect(() => {
    const savedSources = localStorage.getItem("notebook-sources-width");
    const savedStudio = localStorage.getItem("notebook-studio-width");
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onToggleSources: () => onSourcesOpenChange?.(!sourcesOpen),
    onToggleStudio: () => onStudioOpenChange?.(!studioOpen),
    onFocusMode: () => onFocusModeChange?.(!focusMode),
  });

  // Auto-collapse sources on smaller screens when studio is open
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1280 && studioOpen && sourcesOpen) {
        onSourcesOpenChange?.(false);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [studioOpen, sourcesOpen, onSourcesOpenChange]);

  // In focus mode, hide both side panels
  const showSources = !focusMode && sourcesOpen;
  const showStudio = !focusMode && studioOpen;

  return (
    <div className="flex h-full w-full flex-col lg:flex-row">
      {/* Mobile/Tablet: Tab navigation at top */}
      <div className="lg:hidden border-b border-border">
        <Tabs value={mobileTab} onValueChange={setMobileTab} className="w-full">
          <TabsList className="w-full bg-transparent p-0">
            <TabsTrigger value="sources" className="flex-1 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <LayoutPanelLeft className="h-4 w-4 mr-2" />
              Sources
            </TabsTrigger>
            <TabsTrigger value="chat" className="flex-1 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <LayoutPanelTop className="h-4 w-4 mr-2" />
              Chat
            </TabsTrigger>
            <TabsTrigger value="studio" className="flex-1 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <LayoutGrid className="h-4 w-4 mr-2" />
              Studio
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Desktop: Three-column layout with proper widths */}
      <div className="hidden lg:flex lg:flex-1 lg:flex-row lg:min-h-0 lg:min-w-0 lg:overflow-hidden">
        {/* Sources Panel - Left (fixed width, collapsible) */}
        <AnimatePresence mode="wait">
          {showSources && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="shrink-0 overflow-hidden border-r border-border bg-card/40 flex flex-col min-w-0"
              style={{ width: 260 }}
            >
              {sourcesPanel}
            </motion.aside>
          )}
          {!showSources && !focusMode && (
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: 40 }}
              exit={{ width: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="shrink-0 overflow-hidden border-r border-border bg-card/40 flex items-center justify-center"
              style={{ width: 40 }}
              onClick={() => onSourcesOpenChange?.(true)}
              title="Show Sources (⌘B)"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSourcesOpenChange?.(true); }}}
            >
              <PanelLeft className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat Panel - Center (flexible, takes remaining space) */}
        <main className="min-w-0 flex-1 flex flex-col">
          {chatPanel}
        </main>

        {/* Studio Panel - Right (fixed width, collapsible) */}
        <AnimatePresence mode="wait">
          {showStudio && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "clamp(380px, 28vw, 460px)", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="shrink-0 overflow-hidden border-l border-border bg-card/40 flex flex-col min-w-0"
              style={{ width: "clamp(380px, 28vw, 460px)" }}
            >
              {studioPanel}
            </motion.aside>
          )}
          {!showStudio && !focusMode && (
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: 40 }}
              exit={{ width: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="shrink-0 overflow-hidden border-l border-border bg-card/40 flex items-center justify-center"
              style={{ width: 40 }}
              onClick={() => onStudioOpenChange?.(true)}
              title="Show Studio"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onStudioOpenChange?.(true); }}}
            >
              <PanelRight className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile/Tablet: Tab panels */}
      <div className="lg:hidden flex-1 min-h-0">
        <Tabs value={mobileTab} onValueChange={setMobileTab} className="h-full">
          <TabsContent value="sources" className="h-full">
            <Sheet open={sourcesSheetOpen} onOpenChange={setSourcesSheetOpen}>
              <SheetContent side="left" className="h-full w-[85vw] max-w-[320px] p-0">
                <div className="flex h-full w-full flex-col">
                  <div className="flex items-center justify-between border-b border-border p-3">
                    <span className="font-medium">Sources</span>
                    <Button variant="ghost" size="icon" onClick={() => setSourcesSheetOpen(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex-1 overflow-auto">{sourcesPanel}</div>
                </div>
              </SheetContent>
            </Sheet>
            <div className="h-full">
              {mobileTab === "sources" && <div className="h-full">{sourcesPanel}</div>}
            </div>
          </TabsContent>
          
          <TabsContent value="chat" className="h-full">
            <div className="h-full">{chatPanel}</div>
          </TabsContent>
          
          <TabsContent value="studio" className="h-full">
            <Sheet open={studioSheetOpen} onOpenChange={setStudioSheetOpen}>
              <SheetContent side="right" className="h-full w-[85vw] max-w-[480px] p-0">
                <div className="flex h-full w-full flex-col">
                  <div className="flex items-center justify-between border-b border-border p-3">
                    <span className="font-medium">Studio</span>
                    <Button variant="ghost" size="icon" onClick={() => setStudioSheetOpen(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex-1 overflow-auto">{studioPanel}</div>
                </div>
              </SheetContent>
            </Sheet>
            <div className="h-full">
              {mobileTab === "studio" && <div className="h-full">{studioPanel}</div>}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}