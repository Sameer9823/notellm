"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Headphones, Play, Download, Loader2, FileText, RefreshCw, Trash2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAudioStatus } from "@/hooks/use-audio-status";
import { StudioTabs, type StudioTabId } from "./StudioTabs";

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "Queued",
  SCRIPTING: "Writing script",
  SYNTHESIZING: "Recording audio",
  READY: "Ready",
  FAILED: "Failed",
};

export function AudioOverviewPanel({
  notebookId,
  hasReadySources,
  scopeSourceId = null,
  scopeSourceTitle = null,
  open,
  onClose,
  onSwitchTab,
}: {
  notebookId: string;
  hasReadySources: boolean;
  scopeSourceId?: string | null;
  scopeSourceTitle?: string | null;
  open: boolean;
  onClose: () => void;
  onSwitchTab?: (id: StudioTabId) => void;
}) {
  const { overview, step, percent, loading, startGeneration, deleteOverview } = useAudioStatus(notebookId, scopeSourceId);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const isWorking = overview && (overview.status === "QUEUED" || overview.status === "SCRIPTING" || overview.status === "SYNTHESIZING");

  async function handleGenerate() {
    setStarting(true);
    try {
      await startGeneration();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start generation");
    } finally {
      setStarting(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this audio overview? This can't be undone.")) return;
    setDeleting(true);
    try {
      await deleteOverview();
      toast.success("Audio overview deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete audio overview");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
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
                <Headphones className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Audio overview</span>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            {onSwitchTab && <StudioTabs active="audio" onSelect={onSwitchTab} />}

            {scopeSourceId && (
              <div className="border-b border-border bg-primary/5 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
                Scoped to <span className="font-medium text-foreground">{scopeSourceTitle ?? "this source"}</span>
              </div>
            )}

            <ScrollArea className="flex-1">
              <div className="p-4">
                {loading && <div className="text-xs text-muted-foreground">Loading…</div>}

                {!loading && !overview && (
                  <EmptyState hasReadySources={hasReadySources} scopeTitle={scopeSourceTitle} busy={starting} onGenerate={handleGenerate} />
                )}

                {!loading && overview && isWorking && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      {STATUS_LABEL[overview.status]}
                    </div>
                    <Progress value={percent} />
                    {step && <p className="text-xs text-muted-foreground">{step}</p>}
                    <p className="text-xs text-muted-foreground">
                      Two hosts are turning your sources into a short spoken overview. This usually takes a minute or two.
                    </p>
                  </div>
                )}

                {!loading && overview && overview.status === "FAILED" && (
                  <div className="space-y-3">
                    <p className="text-sm text-destructive">{overview.errorMessage || "Audio generation failed."}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={handleGenerate} disabled={starting || deleting}>
                        {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Try again
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={handleDelete} disabled={starting || deleting}>
                        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Delete
                      </Button>
                    </div>
                  </div>
                )}

                {!loading && overview && overview.status === "READY" && overview.hasAudio && (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-secondary/30 p-3">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <Play className="h-3.5 w-3.5 text-primary" />
                        Notebook overview
                        {overview.durationSec ? (
                          <span className="ml-auto font-mono text-[10px] text-muted-foreground">~{Math.round(overview.durationSec / 60)} min</span>
                        ) : null}
                      </div>
                      <audio
                        controls
                        preload="none"
                        className="w-full"
                        src={`/api/notebooks/${notebookId}/audio/${overview.id}/file`}
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <a href={`/api/notebooks/${notebookId}/audio/${overview.id}/file`} download={`audio-overview.mp3`}>
                          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs">
                            <Download className="h-3 w-3" /> Download
                          </Button>
                        </a>
                        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setShowTranscript((v) => !v)}>
                          <FileText className="h-3 w-3" /> {showTranscript ? "Hide" : "Show"} transcript
                        </Button>
                      </div>
                    </div>

                    {showTranscript && overview.script && (
                      <div className="space-y-2.5">
                        {overview.script.map((line, i) => (
                          <div key={i} className={cn("rounded-md border border-transparent px-2.5 py-1.5 text-[13px] leading-relaxed", line.speaker === "A" ? "bg-primary/5" : "bg-secondary/40")}>
                            <span className="mr-1.5 font-mono text-[10px] uppercase text-muted-foreground">Host {line.speaker}</span>
                            {line.text}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={handleGenerate} disabled={starting || deleting}>
                        {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Regenerate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={handleDelete}
                        disabled={starting || deleting}
                      >
                        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function EmptyState({
  hasReadySources,
  scopeTitle,
  busy,
  onGenerate,
}: {
  hasReadySources: boolean;
  scopeTitle?: string | null;
  busy: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Headphones className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h4 className="font-display text-sm font-semibold">
          {scopeTitle ? `Turn "${scopeTitle}" into a podcast` : "Turn this notebook into a podcast"}
        </h4>
        <p className="mx-auto mt-1 max-w-[240px] text-xs text-muted-foreground">
          {scopeTitle
            ? "Two AI hosts will discuss just this source in a short, spoken overview you can listen to or download."
            : hasReadySources
            ? "Two AI hosts will discuss your sources in a short, spoken overview you can listen to or download."
            : "Add and index at least one source first, then generate a spoken overview here."}
        </p>
      </div>
      <Button size="sm" onClick={onGenerate} disabled={!hasReadySources || busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        Generate audio overview
      </Button>
    </div>
  );
}