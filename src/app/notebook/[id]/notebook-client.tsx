"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { ArrowLeft, GraduationCap, Headphones, Map, Share2, StickyNote, Maximize2, Minimize2, PanelLeft, PanelRight, Download } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { SourcesRail } from "@/components/notebook/SourcesRail";
import { AddSourceDialog } from "@/components/source/AddSourceDialog";
import { ShareDialog } from "@/components/notebook/ShareDialog";
import { ExportDialog } from "@/components/notebook/ExportDialog";
import { ChatPanel, type ChatPanelHandle } from "@/components/chat/ChatPanel";
import { StudioPanel } from "@/components/studio/StudioPanel";
import { AudioOverviewPanel } from "@/components/studio/AudioOverviewPanel";
import { RoadmapPanel } from "@/components/studio/RoadmapPanel";
import { ArtifactsPanel } from "@/components/studio/ArtifactsPanel";
import { NotesPanel } from "@/components/notes/NotesPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import type { Citation, MessageDTO, NotebookDTO, SourceDTO } from "@/types";
import { useNotes } from "@/hooks/use-notes";
import { useCredits } from "@/hooks/use-credits";
import { CreditsBadge } from "@/components/shared/CreditsBadge";
import { toast } from "sonner";
import type { StudioTabId } from "@/components/studio/StudioTabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";
import { WorkspaceLayout } from "@/components/notebook/WorkspaceLayout";
import { WorkspaceErrorBoundary, ViewerErrorBoundary } from "@/components/notebook/ErrorBoundary";

type NotebookFull = NotebookDTO & { sources: SourceDTO[]; messages: MessageDTO[] };

type RightPanel =
  | null
  | { kind: "citation"; citation: Citation }
  | { kind: "audio" }
  | { kind: "roadmap" }
  | { kind: "study" }
  | { kind: "notes" };

export function NotebookClient() {
  const { id } = useParams<{ id: string }>();
  const { credits, loading: creditsLoading, refresh: refreshCredits, applyHeaders: applyCreditsHeaders } = useCredits();
  const [notebook, setNotebook] = useState<NotebookFull | null>(null);
  const [allNotebooks, setAllNotebooks] = useState<{ id: string; title: string }[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const chatRef = useRef<ChatPanelHandle>(null);
  const { notes, loading: notesLoading, addNote, deleteNote, reload: reloadNotes } = useNotes(id);
  const [resetKey, setResetKey] = useState(0);

  // UI state for panel visibility
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightPanelKind, setRightPanelKind] = useState<"tabs" | "viewer" | null>("tabs");
  const [focusMode, setFocusMode] = useState(false);

  const handlePin = useCallback(
    async (message: MessageDTO) => {
      try {
        await addNote(message.content, message.citations ?? undefined);
        toast.success("Pinned to notes");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't pin this answer");
      }
    },
    [addNote]
  );

  const activeSource = activeSourceId ? notebook?.sources.find((s) => s.id === activeSourceId) ?? null : null;

  const openCitation = useCallback((c: Citation) => {
    setRightPanel({ kind: "citation", citation: c });
    setRightPanelKind("viewer");
    setRightOpen(true);
    setSourcesOpen(false);
  }, []);

  const openAudio = useCallback(() => {
    setRightPanel({ kind: "audio" });
    setRightPanelKind("tabs");
    setRightOpen(true);
  }, []);

  const openRoadmap = useCallback(() => {
    setRightPanel({ kind: "roadmap" });
    setRightPanelKind("tabs");
    setRightOpen(true);
  }, []);

  const openStudy = useCallback(() => {
    setRightPanel({ kind: "study" });
    setRightPanelKind("tabs");
    setRightOpen(true);
  }, []);

  const openNotes = useCallback(() => {
    setRightPanel({ kind: "notes" });
    setRightPanelKind("tabs");
    setRightOpen(true);
  }, []);

  const closeRightPanel = useCallback(() => {
    setRightPanel(null);
    setRightOpen(false);
  }, []);

  const handleExport = useCallback(async (options: {
    format: "pdf" | "docx";
    sections: string[];
    includeChat: boolean;
    includeCitations: boolean;
    includeSourceText: boolean;
    includeAISummary: boolean;
    includeMemory: boolean;
  }) => {
    const res = await fetch(`/api/notebooks/${id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Export failed" }));
      throw new Error(err.error);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ext = options.format === "docx" ? "docx" : "pdf";
    a.download = `${notebook?.title || "notebook"}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [id, notebook?.title]);

  const audioOpen = rightPanel?.kind === "audio";
  const roadmapOpen = rightPanel?.kind === "roadmap";
  const artifactsOpen = rightPanel?.kind === "study";
  const notesOpen = rightPanel?.kind === "notes";
  const citation = rightPanel?.kind === "citation" ? rightPanel.citation : null;

  const readyYoutubeCount = notebook?.sources.filter((s) => s.type === "YOUTUBE" && s.status === "READY").length ?? 0;

  const load = useCallback(async () => {
    const res = await fetch(`/api/notebooks/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    refreshCredits();
    const { notebook: fresh } = await res.json();
    setNotebook((prev) => {
      if (prev && prev.sources.length > 0 && fresh.sources.length === 0) {
        reloadNotes();
        setResetKey((k) => k + 1);
      }
      return fresh;
    });
  }, [id, reloadNotes, refreshCredits]);

  useEffect(() => {
    load();
    // Fetch all notebooks for command palette
    fetch("/api/notebooks")
      .then((r) => r.json())
      .then((data) => setAllNotebooks(data.notebooks?.map((n: NotebookDTO) => ({ id: n.id, title: n.title })) ?? []));
  }, [load]);

  useKeyboardShortcuts({
    onFocusChat: () => chatRef.current?.focusInput(),
    onAddSource: () => setAddSourceOpen(true),
    onToggleSources: () => setSourcesOpen((v) => !v),
    onToggleStudio: () => setRightOpen((v) => !v),
    onFocusMode: () => setFocusMode((v) => !v),
    onEscape: () => {
      if (rightPanel) {
        closeRightPanel();
      } else if (addSourceOpen) {
        setAddSourceOpen(false);
      } else if (focusMode) {
        setFocusMode(false);
      }
    },
  });

  // All hooks must be called unconditionally - handle loading in JSX instead of early return
  const handleTabSelect = useCallback((tab: StudioTabId) => {
    switch (tab) {
      case "audio":
        openAudio();
        break;
      case "roadmap":
        openRoadmap();
        break;
      case "study":
        openStudy();
        break;
      case "notes":
        openNotes();
        break;
    }
  }, [openAudio, openRoadmap, openStudy, openNotes]);

  const handleSourcesOpenChange = useCallback((open: boolean) => {
    setSourcesOpen(open);
  }, []);

  const handleRightOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setRightPanel(null);
      setRightPanelKind("tabs");
    }
    setRightOpen(open);
  }, []);

  const handleFocusModeChange = useCallback((focus: boolean) => {
    setFocusMode(focus);
  }, []);

  const handleRightPanelKindChange = useCallback((kind: "tabs" | "viewer" | null) => {
    setRightPanelKind(kind);
  }, []);

  // Loading state
  if (!notebook) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="w-full max-w-md space-y-3 px-6">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  const sourcesPanel = (
    <SourcesRail
      notebookId={notebook.id}
      sources={notebook.sources}
      activeSourceId={activeSourceId}
      onSelectSource={setActiveSourceId}
      onRefresh={load}
      addOpen={addSourceOpen}
      onAddOpenChange={setAddSourceOpen}
    />
  );

  const chatPanel = (
    <ChatPanel
      key={`chat-${resetKey}`}
      ref={chatRef}
      notebookId={notebook.id}
      notebookTitle={notebook.title}
      initialMessages={notebook.messages}
      sources={notebook.sources}
      scopeSourceId={activeSourceId}
      scopeSourceTitle={activeSource?.title}
      onOpenCitation={openCitation}
      onPin={handlePin}
      onCreditsHeaders={applyCreditsHeaders}
      focusMode={focusMode}
    />
  );

  // Render the right panel content based on the active panel
  const rightPanelContent = (
    <>
      {rightPanel?.kind === "citation" && (
        <ViewerErrorBoundary>
          <StudioPanel citation={citation} onClose={closeRightPanel} notebookId={notebook?.id} />
        </ViewerErrorBoundary>
      )}
      {rightPanel?.kind === "audio" && (
        <AudioOverviewPanel
          key={`audio-${resetKey}`}
          notebookId={notebook.id}
          hasReadySources={
            activeSourceId ? activeSource?.status === "READY" : notebook.sources.some((s) => s.status === "READY")
          }
          scopeSourceId={activeSourceId}
          scopeSourceTitle={activeSource?.title}
          open={true}
          onClose={closeRightPanel}
          onSwitchTab={openAudio}
        />
      )}
      {rightPanel?.kind === "roadmap" && (
        <RoadmapPanel
          key={`roadmap-${resetKey}`}
          notebookId={notebook.id}
          notebookTitle={notebook.title}
          scopeSourceId={activeSourceId}
          scopeSourceTitle={activeSource?.title}
          refreshSignal={readyYoutubeCount}
          open={true}
          onClose={closeRightPanel}
          onSwitchTab={openRoadmap}
        />
      )}
      {rightPanel?.kind === "study" && (
        <ArtifactsPanel
          key={`artifacts-${resetKey}`}
          notebookId={notebook.id}
          hasReadySources={notebook.sources.some((s) => s.status === "READY")}
          open={true}
          onClose={closeRightPanel}
          onSwitchTab={openStudy}
        />
      )}
      {rightPanel?.kind === "notes" && (
        <NotesPanel
          notes={notes}
          loading={notesLoading}
          addNote={addNote}
          deleteNote={deleteNote}
          open={true}
          onClose={closeRightPanel}
          onSwitchTab={openNotes}
          onOpenCitation={openCitation}
        />
      )}
    </>
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link href="/dashboard" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="hidden items-center gap-1.5 font-display text-sm font-semibold text-muted-foreground sm:flex">
            <Logo className="h-4 w-4 text-primary" />
          </div>
          <span className="truncate font-display text-sm font-semibold">{notebook.title}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <CreditsBadge credits={credits} loading={creditsLoading} />
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => setShareOpen(true)} title="Share">
            <Share2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setExportOpen(true)}
            title="Export"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(audioOpen && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
            onClick={openAudio}
            title="Audio overview"
            aria-pressed={audioOpen}
          >
            <Headphones className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(roadmapOpen && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
            onClick={openRoadmap}
            title="Learning roadmap"
            aria-pressed={roadmapOpen}
          >
            <Map className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(artifactsOpen && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
            onClick={openStudy}
            title="Study tools"
            aria-pressed={artifactsOpen}
          >
            <GraduationCap className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(notesOpen && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
            onClick={openNotes}
            title="Notes"
            aria-pressed={notesOpen}
          >
            <StickyNote className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(citation && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
            onClick={() => {
              if (rightPanel?.kind === "citation") {
                closeRightPanel();
              } else {
                setRightOpen(true);
              }
            }}
            title={citation ? "Close viewer" : "Toggle Studio"}
            disabled={!citation && !rightOpen}
            aria-pressed={!!citation}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(sourcesOpen && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
            onClick={() => setSourcesOpen((v) => !v)}
            title="Toggle Sources (⌘B)"
            aria-pressed={sourcesOpen}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(focusMode && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
            onClick={() => setFocusMode((v) => !v)}
            title={focusMode ? "Exit Focus Mode (Esc)" : "Focus Mode (⌘⇧F)"}
            aria-pressed={focusMode}
          >
            {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <UserButton />
        </div>
      </header>

      <WorkspaceErrorBoundary>
        <WorkspaceLayout
          sourcesPanel={sourcesPanel}
          chatPanel={chatPanel}
          rightPanel={rightPanelContent}
          sourcesOpen={sourcesOpen}
          onSourcesOpenChange={handleSourcesOpenChange}
          rightOpen={rightOpen}
          onRightOpenChange={handleRightOpenChange}
          rightPanelKind={rightPanelKind}
          onRightPanelKindChange={handleRightPanelKindChange}
          focusMode={focusMode}
          onFocusModeChange={handleFocusModeChange}
          onTabSelect={handleTabSelect}
        >
          <AddSourceDialog
            notebookId={notebook.id}
            open={addSourceOpen}
            onOpenChange={setAddSourceOpen}
            onAdded={load}
          />
          <ShareDialog
            notebookId={notebook.id}
            open={shareOpen}
            onOpenChange={setShareOpen}
            initialIsPublic={!!notebook.isPublic}
            initialSlug={notebook.shareSlug}
          />
          <ExportDialog
            open={exportOpen}
            onOpenChange={setExportOpen}
            notebookTitle={notebook.title}
            hasMessages={notebook.messages.length > 0}
            onExport={handleExport}
          />
          <CommandPalette
            onAddSource={() => setAddSourceOpen(true)}
            onToggleTheme={() => {}}
            onNewNotebook={() => {}}
            onFocusChat={() => chatRef.current?.focusInput()}
            notebooks={allNotebooks}
            onSwitchNotebook={(nbId) => { window.location.href = `/notebook/${nbId}`; }}
          />
        </WorkspaceLayout>
      </WorkspaceErrorBoundary>
    </div>
  );
}