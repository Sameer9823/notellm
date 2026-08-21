"use client";

import { useMemo, useState, type DragEvent } from "react";
import { Plus, Library, Search, X, UploadCloud, Loader2, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SourceListItem } from "@/components/source/SourceListItem";
import { useAddSource } from "@/hooks/use-add-source";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SourceDTO } from "@/types";

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
  const readyCount = sources.filter((s) => s.status === "READY").length;
  const { submitting, submitFile, inferFileType } = useAddSource(notebookId, onRefresh);

  const filteredSources = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (s) => s.title.toLowerCase().includes(q) || s.type.toLowerCase().includes(q)
    );
  }, [sources, query]);

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
        toast.error(`"${file.name}" isn't a supported file type (PDF, VTT, SRT, TXT)`);
        continue;
      }
      await submitFile(file, type);
    }
  }

  return (
    <aside
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative flex h-full w-full flex-col border-r border-border bg-card/40"
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
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Library className="h-3.5 w-3.5" />
          Sources
          {sources.length > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground/70">
              {readyCount}/{sources.length}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2 p-3">
        <Button onClick={() => onAddOpenChange(true)} variant="secondary" size="sm" className="w-full justify-start gap-2 border-dashed">
          <Plus className="h-3.5 w-3.5" /> Add source
        </Button>

        {sources.length > 1 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter sources…"
              className="h-8 pl-8 pr-7 text-xs"
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
      </div>

      {sources.length > 0 && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => onSelectSource(null)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg border px-2 py-2 text-left text-sm transition-colors",
              activeSourceId === null ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-secondary/60"
            )}
          >
            <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="font-medium leading-tight">All sources</div>
              <div className="truncate text-[11px] text-muted-foreground">
                Chat, podcast, and roadmap use everything · {readyCount}/{sources.length} ready
              </div>
            </div>
          </button>
        </div>
      )}

      <ScrollArea className="flex-1 px-3 pb-3">
        {sources.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-2 px-2 text-center text-xs text-muted-foreground">
            <Library className="h-6 w-6 opacity-40" />
            <p>No sources yet. Add a PDF, link, video, or transcript to start building this notebook&apos;s knowledge base.</p>
          </div>
        ) : filteredSources.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-2 px-2 text-center text-xs text-muted-foreground">
            <Search className="h-6 w-6 opacity-40" />
            <p>No sources match &quot;{query}&quot;.</p>
          </div>
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