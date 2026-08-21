"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, GraduationCap, Headphones, Library, Map, Menu, Share2, StickyNote, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { SourcesRail } from "@/components/notebook/SourcesRail";
import { AddSourceDialog } from "@/components/source/AddSourceDialog";
import { ShareDialog } from "@/components/notebook/ShareDialog";
import { ChatPanel, type ChatPanelHandle } from "@/components/chat/ChatPanel";
import { StudioPanel } from "@/components/studio/StudioPanel";
import { ArtifactsPanel } from "@/components/studio/ArtifactsPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import type { Citation, MessageDTO, NotebookDTO, SourceDTO } from "@/types";
import { AudioOverviewPanel } from "@/components/studio/AudioOverviewPanel";
import { RoadmapPanel } from "@/components/studio/RoadmapPanel";
import { NotesPanel } from "@/components/notes/NotesPanel";
import { useNotes } from "@/hooks/use-notes";
import { useCredits } from "@/hooks/use-credits";
import { CreditsBadge } from "@/components/shared/CreditsBadge";
import { toast } from "sonner";
import type { StudioTabId } from "@/components/studio/StudioTabs";

type NotebookFull = NotebookDTO & { sources: SourceDTO[]; messages: MessageDTO[] };

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const { credits, loading: creditsLoading, refresh: refreshCredits, applyHeaders: applyCreditsHeaders } = useCredits();
  const [notebook, setNotebook] = useState<NotebookFull | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false);
  const [studioPanel, setStudioPanel] = useState<StudioTabId | null>(null);
  const audioOpen = studioPanel === "audio";
  const roadmapOpen = studioPanel === "roadmap";
  const artifactsOpen = studioPanel === "study";
  const notesOpen = studioPanel === "notes";
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const chatRef = useRef<ChatPanelHandle>(null);
  const { notes, loading: notesLoading, addNote, deleteNote, reload: reloadNotes } = useNotes(id);
  const [resetKey, setResetKey] = useState(0);

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

  const switchPanel = useCallback((id: StudioTabId) => {
    setCitation(null);
    setStudioPanel(id);
  }, []);
  const closePanel = useCallback(() => setStudioPanel(null), []);

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
  }, [load]);

  useKeyboardShortcuts({
    onFocusChat: () => chatRef.current?.focusInput(),
    onAddSource: () => setAddSourceOpen(true),
    onEscape: () => {
      if (citation) setCitation(null);
      else if (studioPanel) closePanel();
      else if (addSourceOpen) setAddSourceOpen(false);
      else if (mobileSourcesOpen) setMobileSourcesOpen(false);
    },
  });

  if (!notebook) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md space-y-3 px-6">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
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
          <Button variant="ghost" size="icon" onClick={() => setShareOpen(true)} title="Share">
            <Share2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileSourcesOpen(true)}
            title="Sources"
          >
            <Library className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(audioOpen && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
            onClick={() => switchPanel("audio")}
            title="Audio overview"
          >
            <Headphones className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(roadmapOpen && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
            onClick={() => switchPanel("roadmap")}
            title="Learning roadmap"
          >
            <Map className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(artifactsOpen && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
            onClick={() => switchPanel("study")}
            title="Study tools"
          >
            <GraduationCap className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(notesOpen && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
            onClick={() => switchPanel("notes")}
            title="Notes"
          >
            <StickyNote className="h-4 w-4" />
          </Button>
          <UserButton />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Desktop sources rail — always visible at lg+ */}
        <div className="hidden lg:block lg:w-[280px] lg:shrink-0">
          <SourcesRail
            notebookId={notebook.id}
            sources={notebook.sources}
            activeSourceId={activeSourceId}
            onSelectSource={setActiveSourceId}
            onRefresh={load}
            addOpen={addSourceOpen}
            onAddOpenChange={setAddSourceOpen}
          />
        </div>

        {/* Mobile/tablet sources drawer */}
        <AnimatePresence>
          {mobileSourcesOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileSourcesOpen(false)}
                className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
              />
              <motion.div
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[320px] lg:hidden"
              >
                <div className="relative h-full">
                  <button
                    onClick={() => setMobileSourcesOpen(false)}
                    className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-secondary/80 text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <SourcesRail
                    notebookId={notebook.id}
                    sources={notebook.sources}
                    activeSourceId={activeSourceId}
                    onSelectSource={(sid) => {
                      setActiveSourceId(sid);
                      setMobileSourcesOpen(false);
                    }}
                    onRefresh={load}
                    addOpen={addSourceOpen}
                    onAddOpenChange={setAddSourceOpen}
                  />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Rendered once here (not inside SourcesRail) so opening it never
            mounts two overlapping Dialog instances. */}
        <AddSourceDialog
          notebookId={notebook.id}
          open={addSourceOpen}
          onOpenChange={setAddSourceOpen}
          onAdded={load}
        />

        <div className="min-w-0 flex-1">
          <ChatPanel
            key={`chat-${resetKey}`}
            ref={chatRef}
            notebookId={notebook.id}
            notebookTitle={notebook.title}
            initialMessages={notebook.messages}
            sources={notebook.sources}
            scopeSourceId={activeSourceId}
            scopeSourceTitle={activeSource?.title}
            onOpenCitation={(c) => {
              setStudioPanel(null);
              setCitation(c);
            }}
            onPin={handlePin}
            onCreditsHeaders={applyCreditsHeaders}
          />
        </div>

        <StudioPanel citation={citation} onClose={() => setCitation(null)} />
        <AudioOverviewPanel
          key={`audio-${resetKey}`}
          notebookId={notebook.id}
          hasReadySources={
            activeSourceId ? activeSource?.status === "READY" : notebook.sources.some((s) => s.status === "READY")
          }
          scopeSourceId={activeSourceId}
          scopeSourceTitle={activeSource?.title}
          open={audioOpen}
          onClose={closePanel}
          onSwitchTab={switchPanel}
        />
        <RoadmapPanel
          key={`roadmap-${resetKey}`}
          notebookId={notebook.id}
          notebookTitle={notebook.title}
          scopeSourceId={activeSourceId}
          scopeSourceTitle={activeSource?.title}
          refreshSignal={readyYoutubeCount}
          open={roadmapOpen}
          onClose={closePanel}
          onSwitchTab={switchPanel}
        />
        <ArtifactsPanel
          key={`artifacts-${resetKey}`}
          notebookId={notebook.id}
          hasReadySources={notebook.sources.some((s) => s.status === "READY")}
          open={artifactsOpen}
          onClose={closePanel}
          onSwitchTab={switchPanel}
        />
        <NotesPanel
          notes={notes}
          loading={notesLoading}
          addNote={addNote}
          deleteNote={deleteNote}
          open={notesOpen}
          onClose={closePanel}
          onSwitchTab={switchPanel}
          onOpenCitation={(c) => {
            setStudioPanel(null);
            setCitation(c);
          }}
        />
      </div>
      <ShareDialog
        notebookId={notebook.id}
        open={shareOpen}
        onOpenChange={setShareOpen}
        initialIsPublic={!!notebook.isPublic}
        initialSlug={notebook.shareSlug}
      />
    </div>
  );
}