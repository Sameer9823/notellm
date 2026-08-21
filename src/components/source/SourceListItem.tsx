"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Trash2, MoreVertical, Pencil, Check, X } from "lucide-react";
import { StatusDot, statusLabel } from "@/components/source/StatusDot";
import { sourceTypeIcon } from "@/lib/source-meta";
import { useSourceStatus } from "@/hooks/use-source-status";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn, truncate } from "@/lib/utils";
import { toast } from "sonner";
import type { SourceDTO } from "@/types";

export function SourceListItem({
  source,
  active,
  onSelect,
  onRemoved,
  onSettled,
  onRenamed,
}: {
  source: SourceDTO;
  active: boolean;
  onSelect: () => void;
  onRemoved: () => void;
  /** Called once when this source's live-polled status settles into a
   *  terminal state (READY/FAILED) that differs from what the parent's
   *  notebook snapshot last knew about — lets the parent refetch so
   *  things gated on source status (e.g. the podcast "Generate" button)
   *  don't stay stuck on stale data after a background indexing run
   *  finishes. */
  onSettled?: () => void;
  /** Called after a successful rename so the parent can refetch and get
   *  the new title into the notebook snapshot (chat citations, etc). */
  onRenamed?: () => void;
}) {
  const { status, step, errorMessage, restart } = useSourceStatus(source.id, source.status);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(source.title);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const Icon = sourceTypeIcon[source.type];
  const isWorking = status === "INDEXING" || status === "QUEUED" || status === "UPLOADING";

  useEffect(() => {
    if (renaming) {
      setRenameValue(source.title);
      requestAnimationFrame(() => renameInputRef.current?.select());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renaming]);

  const notifiedRef = useRef(false);
  useEffect(() => {
    if (notifiedRef.current) return;
    const wasTerminal = source.status === "READY" || source.status === "FAILED";
    const isTerminal = status === "READY" || status === "FAILED";
    if (!wasTerminal && isTerminal) {
      notifiedRef.current = true;
      onSettled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/sources/${source.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Source removed");
      onRemoved();
    } catch {
      toast.error("Couldn't remove source");
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    const title = renameValue.trim();
    if (!title || title === source.title) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error();
      toast.success("Source renamed");
      setRenaming(false);
      onRenamed?.();
    } catch {
      toast.error("Couldn't rename source");
    } finally {
      setBusy(false);
    }
  }

  async function reindex() {
    setBusy(true);
    try {
      const res = await fetch(`/api/sources/${source.id}/reindex`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Couldn't start re-indexing");
      }
      // The server just flipped this source back to QUEUED — restart the
      // status hook's polling loop, since it stopped itself when this
      // source last reached a terminal state (e.g. FAILED). Without this
      // the row stays stuck showing "Failed" until the page is refreshed.
      restart("QUEUED");
      toast.success("Re-indexing started");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start re-indexing");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2 py-2 text-sm transition-colors",
        active ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-secondary/60"
      )}
    >
      {/* Only this inner area selects the source — the menu button is a
          fully separate sibling, so there's no bubbling/overlap between them. */}
      {renaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename();
              else if (e.key === "Escape") setRenaming(false);
            }}
            disabled={busy}
            maxLength={160}
            className="h-6 min-w-0 flex-1 rounded border border-primary/40 bg-background px-1.5 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={rename}
            disabled={busy}
            aria-label="Save name"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setRenaming(false)}
            disabled={busy}
            aria-label="Cancel rename"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          title={status === "FAILED" ? errorMessage ?? "Indexing failed" : source.title}
          className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden text-left"
        >
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="truncate font-medium leading-tight">{truncate(source.title, 26)}</div>
            <div className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
              <StatusDot status={status} size="sm" />
              <span className="truncate">
                {status === "FAILED" ? (errorMessage ? truncate(errorMessage, 30) : "Failed") : isWorking && step ? step : statusLabel(status)}
              </span>
              {status === "READY" && source.chunkCount > 0 && <span className="shrink-0">· {source.chunkCount} chunks</span>}
            </div>
          </div>
        </button>
      )}

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busy}
            aria-label="Source actions"
            className={cn(
              "flex shrink-0 items-center justify-center rounded-md border border-border bg-secondary p-2 text-foreground transition-colors hover:bg-secondary/80",
              menuOpen && "ring-1 ring-primary/50"
            )}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenaming(true)} disabled={busy}>
            <Pencil className="h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={reindex} disabled={busy || isWorking}>
            <RefreshCw className="h-3.5 w-3.5" /> Re-index
          </DropdownMenuItem>
          <DropdownMenuItem onClick={remove} disabled={busy} className="text-destructive focus:text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.div>
  );
}