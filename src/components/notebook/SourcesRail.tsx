"use client";

import { useMemo, useState, type DragEvent } from "react";
import {
  Plus,
  Library,
  Search,
  X,
  UploadCloud,
  Loader2,
  LayoutGrid,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SourceListItem } from "@/components/source/SourceListItem";
import { useAddSource } from "@/hooks/use-add-source";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SourceDTO } from "@/types";
import { Empty } from "@/components/ui/empty";

export function SourcesRail({
  notebookId,
  sources,
  activeSourceId,
  onSelectSource,
  onRefresh,
  addOpen,
  onAddOpenChange,
}: {
  notebookId: string;
  sources: SourceDTO[];
  activeSourceId: string | null;
  onSelectSource: (id: string | null) => void;
  onRefresh: () => void;
  addOpen: boolean;
  onAddOpenChange: (v: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const readyCount = sources.filter((s) => s.status === "READY").length;
  const { submitting, submitFile, inferFileType } = useAddSource(
    notebookId,
    onRefresh,
  );

  const filteredSources = useMemo(() => {
    let result = sources;
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) || s.type.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "ALL") {
      result = result.filter((s) => s.status === statusFilter);
    }
    return result;
  }, [sources, query, statusFilter]);

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      setDragCounter((c) => c + 1);
      setDragActive(true);
    }
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    setDragCounter((c) => {
      const next = c - 1;
      if (next <= 0) setDragActive(false);
      return next;
    });
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragActive(false);
    setDragCounter(0);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (!files.length) return;

    for (const file of files) {
      const type = inferFileType(file);
      if (!type) {
        toast.error(
          `"${file.name}" isn't a supported file type (PDF, VTT, SRT, TXT)`,
        );
        continue;
      }
      await submitFile(file, type);
    }
  }

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: sources.length };
    for (const s of sources) {
      counts[s.status] = (counts[s.status] ?? 0) + 1;
    }
    return counts;
  }, [sources]);

  return (
    <aside
      data-testid="sources-rail"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative flex h-full w-full flex-col min-w-0"
    >
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-primary bg-background/90 backdrop-blur-sm">
          <UploadCloud className="h-8 w-8 text-primary" />
          <p className="text-sm font-medium">Drop to add source</p>
          <p className="text-xs text-muted-foreground">PDF, VTT, SRT, or TXT</p>
        </div>
      )}
      {submitting && (
        <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-[11px] text-muted-foreground shadow">
          <Loader2 className="h-3 w-3 animate-spin" /> Uploading…
        </div>
      )}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Library className="h-4 w-4" />
          <span>Sources</span>
          {sources.length > 0 && (
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {readyCount}/{sources.length}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2 px-3 pt-2">
        <Button
          onClick={() => onAddOpenChange(true)}
          variant="outline"
          size="sm"
          className="h-8 w-full gap-1.5 text-[13px]"
        >
          <Plus className="h-4 w-4" /> Add source
        </Button>

        {sources.length > 1 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter sources…"
              className="h-8 pl-8 pr-7 text-[13px]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear filter"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {sources.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin py-1">
            <button
              type="button"
              aria-pressed={statusFilter === "ALL"}
              onClick={() => setStatusFilter("ALL")}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium tabular-nums",
                statusFilter === "ALL"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60",
              )}
            >
              All {statusCounts.ALL}
            </button>
            {(statusCounts.READY > 0 || statusFilter === "READY") && (
              <button
                type="button"
                aria-pressed={statusFilter === "READY"}
                onClick={() => setStatusFilter("READY")}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium tabular-nums",
                  statusFilter === "READY"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                Ready {statusCounts.READY ?? 0}
              </button>
            )}
            {(statusCounts.INDEXING > 0 ||
              statusCounts.QUEUED > 0 ||
              statusCounts.UPLOADING > 0 ||
              statusFilter === "INDEXING") && (
              <button
                type="button"
                aria-pressed={statusFilter === "INDEXING"}
                onClick={() => setStatusFilter("INDEXING")}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium tabular-nums",
                  statusFilter === "INDEXING"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                Indexing{" "}
                {(statusCounts.INDEXING ?? 0) +
                  (statusCounts.QUEUED ?? 0) +
                  (statusCounts.UPLOADING ?? 0)}
              </button>
            )}
            {(statusCounts.QUEUED > 0 || statusFilter === "QUEUED") && (
              <button
                type="button"
                aria-pressed={statusFilter === "QUEUED"}
                onClick={() => setStatusFilter("QUEUED")}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium tabular-nums",
                  statusFilter === "QUEUED"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                Queued {statusCounts.QUEUED ?? 0}
              </button>
            )}
            {(statusCounts.FAILED > 0 || statusFilter === "FAILED") && (
              <button
                type="button"
                aria-pressed={statusFilter === "FAILED"}
                onClick={() => setStatusFilter("FAILED")}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium tabular-nums",
                  statusFilter === "FAILED"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                Failed {statusCounts.FAILED ?? 0}
              </button>
            )}
          </div>
        )}
      </div>

      {sources.length > 0 && (
        <div className="px-3 pb-1">
          <button
            type="button"
            onClick={() => onSelectSource(null)}
            aria-current={activeSourceId === null ? "true" : undefined}
            className={cn(
              "relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              activeSourceId === null
                ? "bg-secondary"
                : "hover:bg-secondary/60",
            )}
          >
            {activeSourceId === null && (
              <span className="absolute inset-y-0 left-0 w-0.5 rounded-r bg-primary" />
            )}
            <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-foreground">
                All sources
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {readyCount}/{sources.length} ready · Chat, audio & roadmap
              </div>
            </div>
          </button>
        </div>
      )}

      <ScrollArea className="flex-1 px-3 pb-3">
        {sources.length === 0 ? (
          <Empty
            className="mt-6"
            icon={<Library className="h-6 w-6" />}
            title="No sources yet"
            description="Add a PDF, link, video, or transcript to start building this notebook's knowledge base."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAddOpenChange(true)}
                className="h-8 w-full gap-1.5 text-[13px]"
              >
                <Plus className="h-4 w-4" /> Add source
              </Button>
            }
          />
        ) : filteredSources.length === 0 ? (
          <Empty
            className="mt-6"
            icon={<Search className="h-6 w-6" />}
            title={
              query
                ? `No sources match &ldquo;{query}&rdquo;`
                : "No sources match filter"
            }
            description={
              query
                ? "Try a different search term or clear the filter."
                : "No sources with the selected status."
            }
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("ALL");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="space-y-1">
            {filteredSources.map((s) => (
              <SourceListItem
                key={s.id}
                source={s}
                active={s.id === activeSourceId}
                onSelect={() => onSelectSource(s.id)}
                onRemoved={onRefresh}
                onSettled={onRefresh}
                onRenamed={onRefresh}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}
