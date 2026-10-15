"use client";

import { useState, useCallback } from "react";
import {
  X,
  Map,
  Loader2,
  RefreshCw,
  Youtube,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatTimestamp } from "@/lib/source-meta";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRoadmapStatus } from "@/hooks/use-roadmap-status";
import { ExportMenu } from "@/components/shared/ExportMenu";
import {
  downloadMarkdown,
  printAsPdf,
  roadmapToMarkdown,
  roadmapToPdfHtml,
} from "@/lib/export";
import { StudioTabs, type StudioTabId } from "./StudioTabs";
import type { RoadmapNodeDTO } from "@/types";

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "Queued",
  CLUSTERING: "Clustering concepts",
  LABELING: "Naming concepts",
  ORDERING: "Ordering the roadmap",
  READY: "Ready",
  FAILED: "Failed",
};

const MIN_VIDEOS = 2;

export function RoadmapPanel({
  notebookId,
  notebookTitle = "Notebook",
  scopeSourceId = null,
  scopeSourceTitle = null,
  refreshSignal,
  open,
  onClose,
  onSwitchTab,
}: {
  notebookId: string;
  notebookTitle?: string;
  scopeSourceId?: string | null;
  scopeSourceTitle?: string | null;
  /** Bump this (e.g. count of READY YouTube sources) whenever the notebook's
   *  sources change, so the panel re-fetches videoCount instead of relying
   *  on its one-shot poll from mount. */
  refreshSignal?: number;
  open: boolean;
  onClose: () => void;
  onSwitchTab?: (id: StudioTabId) => void;
}) {
  if (!open) return null;
  const {
    roadmap,
    videoCount,
    step,
    percent,
    loading,
    startGeneration,
    deleteRoadmap,
  } = useRoadmapStatus(notebookId, refreshSignal);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isWorking =
    roadmap &&
    (roadmap.status === "QUEUED" ||
      roadmap.status === "CLUSTERING" ||
      roadmap.status === "LABELING" ||
      roadmap.status === "ORDERING");
  const canGenerate = videoCount >= MIN_VIDEOS;
  const isStale =
    !!roadmap &&
    roadmap.status === "READY" &&
    roadmap.sourceCount !== videoCount;

  async function handleGenerate() {
    setStarting(true);
    try {
      await startGeneration();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Couldn't start roadmap generation",
      );
    } finally {
      setStarting(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this roadmap? This can't be undone.")) return;
    setDeleting(true);
    try {
      await deleteRoadmap();
      toast.success("Roadmap deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete roadmap");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full flex-col min-w-0">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Map className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Learning roadmap</span>
        </div>
        <div className="flex items-center gap-1">
          <ExportMenu
            label="Export roadmap"
            disabled={!roadmap?.nodes?.length}
            onMarkdown={() =>
              downloadMarkdown(
                `${notebookTitle} - roadmap`,
                roadmapToMarkdown(notebookTitle, roadmap?.nodes ?? []),
              )
            }
            onPdf={() =>
              printAsPdf(
                `${notebookTitle} — Learning roadmap`,
                roadmapToPdfHtml(notebookTitle, roadmap?.nodes ?? []),
              )
            }
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {onSwitchTab && (
        <StudioTabs active="roadmap" onSelect={onSwitchTab} />
      )}

      {scopeSourceId && (
        <div className="border-b border-border bg-secondary/30 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
          Roadmaps always span every linked video, not just{" "}
          <span className="font-medium text-foreground">
            {scopeSourceTitle ?? "the selected source"}
          </span>{" "}
          — switch to &quot;All sources&quot; to generate one.
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-4">
          {loading && (
            <div className="text-xs text-muted-foreground">Loading…</div>
          )}

          {!loading && !roadmap && (
            <EmptyState
              canGenerate={canGenerate}
              videoCount={videoCount}
              busy={starting}
              onGenerate={handleGenerate}
            />
          )}

          {!loading && roadmap && isWorking && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {STATUS_LABEL[roadmap.status]}
              </div>
              <Progress value={percent} />
              {step && (
                <p className="text-xs text-muted-foreground">{step}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Clustering transcript chunks across your linked videos,
                naming each concept, and ordering them by how the
                terminology actually progresses. This usually takes a
                minute or two.
              </p>
            </div>
          )}

          {!loading && roadmap && roadmap.status === "FAILED" && (
            <div className="space-y-3">
              <p className="text-sm text-destructive">
                {roadmap.errorMessage || "Roadmap generation failed."}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleGenerate}
                  disabled={starting || deleting || !canGenerate}
                >
                  {starting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Try again
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDelete}
                  disabled={starting || deleting}
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Delete
                </Button>
              </div>
            </div>
          )}

          {!loading &&
            roadmap &&
            roadmap.status === "READY" &&
            roadmap.nodes && (
              <div className="space-y-4">
                {isStale && (
                  <div className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
                    This roadmap was built from {roadmap.sourceCount}{" "}
                    video{roadmap.sourceCount === 1 ? "" : "s"};{" "}
                    {videoCount} are linked now. Regenerate to include
                    everything.
                  </div>
                )}

                <RoadmapTimeline nodes={roadmap.nodes} />

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={handleGenerate}
                    disabled={starting || deleting || !canGenerate}
                  >
                    {starting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Regenerate
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={handleDelete}
                    disabled={starting || deleting}
                  >
                    {deleting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            )}
        </div>
      </ScrollArea>
    </div>
  );
}

function EmptyState({
  canGenerate,
  videoCount,
  busy,
  onGenerate,
}: {
  canGenerate: boolean;
  videoCount: number;
  busy: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Map className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h4 className="font-display text-sm font-semibold">
          Turn your videos into a roadmap
        </h4>
        <p className="mx-auto mt-1 max-w-[260px] text-xs text-muted-foreground">
          {canGenerate
            ? `Cluster concepts across your ${videoCount} linked videos, label them, and order them into a concept-by-concept learning path.`
            : `Link at least ${MIN_VIDEOS} indexed YouTube videos to this notebook, then generate a roadmap here. Currently linked: ${videoCount}.`}
        </p>
      </div>
      <Button size="sm" onClick={onGenerate} disabled={!canGenerate || busy}>
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Map className="h-3.5 w-3.5" />
        )}
        Generate roadmap
      </Button>
    </div>
  );
}

function RoadmapTimeline({ nodes }: { nodes: RoadmapNodeDTO[] }) {
  const ordered = [...nodes].sort((a, b) => a.order - b.order);
  return (
    <div className="relative space-y-0">
      {ordered.map((node, i) => (
        <div key={node.id} className="relative flex gap-3 pb-5 last:pb-0">
          <div className="flex flex-col items-center">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-[11px] font-semibold text-primary">
              {i + 1}
            </div>
            {i < ordered.length - 1 && (
              <div className="mt-1 w-px flex-1 bg-border" />
            )}
          </div>
          <RoadmapNode node={node} />
        </div>
      ))}
    </div>
  );
}

function RoadmapNode({ node }: { node: RoadmapNodeDTO }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-border bg-secondary/20 p-3">
      <h4 className="font-display text-sm font-semibold leading-snug">
        {node.label}
      </h4>
      <p className="mt-1 text-xs text-muted-foreground">{node.summary}</p>

      {node.keywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {node.keywords.map((kw) => (
            <Badge
              key={kw}
              variant="outline"
              className="px-1.5 py-0 text-[10px] font-normal"
            >
              {kw}
            </Badge>
          ))}
        </div>
      )}

      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        {expanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        {node.videos.length} video{node.videos.length === 1 ? "" : "s"} ·{" "}
        {node.chunkCount} moment
        {node.chunkCount === 1 ? "" : "s"}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
          {node.videos.map((v) => (
            <div key={v.sourceId} className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Youtube className="h-3 w-3 shrink-0 text-primary" />
                <span className="truncate">{v.title}</span>
              </div>
              <div className="flex flex-wrap gap-1 pl-4">
                {v.timestamps.slice(0, 6).map((ts) =>
                  v.originUrl ? (
                    <a
                      key={ts}
                      href={`${v.originUrl}${v.originUrl.includes("?") ? "&" : "?"}t=${Math.max(0, ts)}s`}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        "rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground",
                        "hover:border-primary/50 hover:text-primary",
                      )}
                    >
                      {formatTimestamp(ts)}
                    </a>
                  ) : (
                    <span
                      key={ts}
                      className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {formatTimestamp(ts)}
                    </span>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
