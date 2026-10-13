"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  File as FileIcon,
  Youtube,
  FileText,
  Captions,
  Globe,
  Loader2,
  Upload,
  ArrowLeft,
  Search,
  Check,
  ExternalLink,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAddSource } from "@/hooks/use-add-source";
import { useWebSearch, type WebSearchResult } from "@/hooks/use-web-search";
import type { SourceType } from "@/types";

type PickerType = SourceType | "WEB_SEARCH";
type Tile = { type: PickerType; label: string; hint: string; icon: typeof FileIcon };

const TILES: Tile[] = [
  { type: "PDF", label: "PDF", hint: "Upload a .pdf file", icon: FileIcon },
  { type: "YOUTUBE", label: "YT Link", hint: "Paste a YouTube URL", icon: Youtube },
  { type: "TEXT", label: "Text", hint: "Paste or type plain text", icon: FileText },
  { type: "VTT", label: "VTT", hint: "Upload a transcript file", icon: Captions },
  { type: "URL", label: "Web Link", hint: "Paste any article URL", icon: Globe },
  { type: "WEB_SEARCH", label: "Web Search", hint: "Search the web and pick results to add", icon: Search },
];

export function AddSourceDialog({
  notebookId,
  open,
  onOpenChange,
  onAdded,
}: {
  notebookId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const [selected, setSelected] = useState<PickerType | null>(null);
  const { submitting, submitJson: submitJsonBase, submitFile: submitFileBase } = useAddSource(notebookId, onAdded);
  const webSearch = useWebSearch(notebookId, onAdded);

  function reset() {
    setSelected(null);
    webSearch.reset();
  }

  async function handleAddSelected(picked: WebSearchResult[]) {
    const ok = await webSearch.addSelected(picked);
    if (ok) {
      onOpenChange(false);
      reset();
    }
  }

  async function submitJson(body: object) {
    const ok = await submitJsonBase(body);
    if (ok) {
      onOpenChange(false);
      reset();
    }
  }

  async function submitFile(file: File, type: "PDF" | "VTT") {
    const ok = await submitFileBase(file, type);
    if (ok) {
      onOpenChange(false);
      reset();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          {selected && (
            <button
              onClick={() => setSelected(null)}
              className="mb-1 flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Back
            </button>
          )}
          <DialogTitle>{selected ? TILES.find((t) => t.type === selected)?.label : "Add source"}</DialogTitle>
          <DialogDescription>
            {selected
              ? TILES.find((t) => t.type === selected)?.hint
              : "Choose a source type. Each source is extracted, chunked, embedded, and indexed for this notebook only."}
          </DialogDescription>
        </DialogHeader>

        {!selected && (
          <div className="grid grid-cols-3 gap-3">
            {TILES.map((tile, i) => (
              <motion.button
                key={tile.type}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => setSelected(tile.type)}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-secondary/40 p-5 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-primary/10",
                  tile.type === "URL" && "col-span-1"
                )}
              >
                <tile.icon className="h-5 w-5 text-muted-foreground" />
                {tile.label}
              </motion.button>
            ))}
          </div>
        )}

        {selected === "PDF" && <FileDrop accept=".pdf" busy={submitting} onFile={(f) => submitFile(f, "PDF")} label="Drop a PDF or click to browse" />}
        {selected === "VTT" && <FileDrop accept=".vtt,.srt,.txt" busy={submitting} onFile={(f) => submitFile(f, "VTT")} label="Drop a .vtt transcript or click to browse" />}

        {selected === "YOUTUBE" && (
          <UrlForm
            placeholder="https://www.youtube.com/watch?v=..."
            busy={submitting}
            onSubmit={(url) => submitJson({ type: "YOUTUBE", url })}
          />
        )}

        {selected === "URL" && (
          <UrlForm
            placeholder="https://example.com/article"
            busy={submitting}
            onSubmit={(url) => submitJson({ type: "URL", url })}
          />
        )}

        {selected === "TEXT" && <TextForm busy={submitting} onSubmit={(title, content) => submitJson({ type: "TEXT", title, content })} />}

        {selected === "WEB_SEARCH" && (
          <WebSearchForm
            searching={webSearch.searching}
            adding={webSearch.adding}
            results={webSearch.results}
            onSearch={webSearch.search}
            onAdd={handleAddSelected}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileDrop({ accept, busy, onFile, label }: { accept: string; busy: boolean; onFile: (f: File) => void; label: string }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground transition-colors hover:border-primary/50",
        dragOver && "border-primary bg-primary/5"
      )}
    >
      {busy ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <Upload className="h-6 w-6" />}
      <span>{busy ? "Uploading…" : label}</span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function UrlForm({ placeholder, busy, onSubmit }: { placeholder: string; busy: boolean; onSubmit: (url: string) => void }) {
  const [url, setUrl] = useState("");
  return (
    <form
    onSubmit={(e) => {
      e.preventDefault();
      const trimmed = url.trim();
      if (!trimmed) return;
      // `z.string().url()` rejects scheme-less input like "youtube.com/...",
      // which the server surfaces as a 400. Normalize bare URLs so pasting a
      // link without the protocol doesn't fail at the API edge.
      const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      onSubmit(normalized);
    }}
    className="space-y-3"
  >
      <div className="space-y-1.5">
        <Label htmlFor="url">URL</Label>
        <Input id="url" autoFocus placeholder={placeholder} value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
      </div>
      <Button type="submit" disabled={busy || !url.trim()} className="w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add source"}
      </Button>
    </form>
  );
}

function WebSearchForm({
  searching,
  adding,
  results,
  onSearch,
  onAdd,
}: {
  searching: boolean;
  adding: boolean;
  results: WebSearchResult[] | null;
  onSearch: (query: string) => void;
  onAdd: (picked: WebSearchResult[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function toggle(url: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  const selectedResults = (results ?? []).filter((r) => picked.has(r.url));

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim() && !searching) {
            setPicked(new Set());
            onSearch(query.trim());
          }
        }}
        className="flex gap-2"
      >
        <Input
          autoFocus
          placeholder="e.g. latest research on spaced repetition"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={searching || adding}
        />
        <Button type="submit" disabled={searching || adding || !query.trim()}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </form>

      {searching && (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching the web…
        </div>
      )}

      {!searching && results && results.length > 0 && (
        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {results.map((r) => {
            const isPicked = picked.has(r.url);
            return (
              <button
                key={r.url}
                type="button"
                onClick={() => toggle(r.url)}
                disabled={adding}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors disabled:opacity-60",
                  isPicked ? "border-primary/50 bg-primary/10" : "border-border hover:bg-secondary/30"
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    isPicked ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  )}
                >
                  {isPicked && <Check className="h-3 w-3" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.title}</div>
                  <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{r.url}</span>
                  </div>
                  {r.snippet && <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{r.snippet}</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!searching && results && results.length === 0 && (
        <p className="py-6 text-center text-xs text-muted-foreground">No results — try a different search.</p>
      )}

      {results && results.length > 0 && (
        <Button className="w-full" disabled={adding || selectedResults.length === 0} onClick={() => onAdd(selectedResults)}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : `Add ${selectedResults.length || ""} source${selectedResults.length === 1 ? "" : "s"}`}
        </Button>
      )}
    </div>
  );
}

function TextForm({ busy, onSubmit }: { busy: boolean; onSubmit: (title: string, content: string) => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() && content.trim()) onSubmit(title.trim(), content.trim());
      }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" autoFocus placeholder="e.g. Meeting notes — Q3 planning" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="content">Content</Label>
        <Textarea id="content" rows={8} placeholder="Paste your text here…" value={content} onChange={(e) => setContent(e.target.value)} disabled={busy} />
      </div>
      <Button type="submit" disabled={busy || !title.trim() || !content.trim()} className="w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add source"}
      </Button>
    </form>
  );
}