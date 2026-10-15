"use client";

import { useState, useCallback } from "react";
import { X, StickyNote, Plus, Trash2, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CitationChip } from "@/components/chat/CitationChip";
import { toast } from "sonner";
import { StudioTabs, type StudioTabId } from "@/components/studio/StudioTabs";
import type { Citation, NoteDTO } from "@/types";

/**
 * Notes panel — a running scratchpad for the notebook. Notes either come
 * from "Pin" on an assistant chat message (content + its citations carried
 * over verbatim) or are typed directly here.
 *
 * Notes state is owned by the parent page (a single `useNotes` instance)
 * and passed in as props, rather than this panel calling its own copy of
 * the hook — otherwise a note pinned from the chat updates the page's
 * state while this panel keeps rendering its own stale copy until a full
 * reload, which looked like "pinning doesn't do anything."
 */
export function NotesPanel({
  notes,
  loading,
  addNote,
  deleteNote,
  open,
  onClose,
  onOpenCitation,
  onSwitchTab,
}: {
  notes: NoteDTO[];
  loading: boolean;
  addNote: (content: string, citations?: NoteDTO["citations"]) => Promise<NoteDTO>;
  deleteNote: (id: string) => Promise<void>;
  open: boolean;
  onClose: () => void;
  onOpenCitation: (c: Citation) => void;
  onSwitchTab?: (id: StudioTabId) => void;
}) {
  if (!open) return null;
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleAdd = useCallback(async () => {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      await addNote(content);
      setDraft("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save note");
    } finally {
      setSaving(false);
    }
  }, [addNote, draft]);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await deleteNote(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete note");
    } finally {
      setDeletingId(null);
    }
  }, [deleteNote]);

  return (
    <div className="flex h-full flex-col min-w-0">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <StickyNote className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Notes</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {onSwitchTab && <StudioTabs active="notes" onSelect={onSwitchTab} />}

      <div className="space-y-2 border-b border-border p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Jot down a note…"
          rows={3}
          className="resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <Button size="sm" className="w-full" onClick={handleAdd} disabled={saving || !draft.trim()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add note
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {loading && <div className="text-xs text-muted-foreground">Loading…</div>}

          {!loading && notes.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <StickyNote className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="font-display text-sm font-semibold">No notes yet</h4>
                <p className="mx-auto mt-1 max-w-[240px] text-xs text-muted-foreground">
                  Write a note above, or pin an answer from the chat to save it here with its citations.
                </p>
              </div>
            </div>
          )}

          {!loading &&
            notes.map((note) => (
              <div key={note.id} className="rounded-lg border border-border bg-secondary/20 p-3">
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{note.content}</p>

                {note.citations && note.citations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {note.citations.map((c) => (
                      <CitationChip key={`${c.chunkId}-${c.marker}`} citation={c} onOpen={onOpenCitation} />
                    ))}
                  </div>
                )}

                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(note.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  <button
                    onClick={() => handleDelete(note.id)}
                    disabled={deletingId === note.id}
                    title="Delete note"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    {deletingId === note.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}