"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Brain, Loader2, Sparkles, Trash2, Plus, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Logo } from "@/components/ui/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useMemories, type MemoryDTO } from "@/hooks/use-memories";

export default function MemoryPage() {
  const { memories, loading, create, update, remove } = useMemories();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await create(draft.trim());
      setDraft("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save memory");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await remove(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete memory");
    }
  }

  return (
    <div className="min-h-screen bg-grid">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-display text-lg font-semibold">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            <Logo className="h-5 w-5 text-primary" />
            Memory
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-border bg-card/40 p-4">
          <Brain className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h2 className="font-display text-sm font-semibold">What Footnote remembers about you</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              These are durable facts — goals, preferences, background — that carry across every notebook&apos;s chat. Add your
              own, or let them be learned automatically from conversations.
            </p>
          </div>
        </div>

        <div className="mb-6 flex gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. I'm studying for the MCAT and prefer concise answers"
            className="min-h-[44px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleCreate();
              }
            }}
          />
          <Button onClick={handleCreate} disabled={saving || !draft.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        )}

        {!loading && memories?.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
            <Sparkles className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No memories yet. Add one above, or just keep chatting.</p>
          </div>
        )}

        <div className="space-y-2">
          {memories?.map((m) => (
            <MemoryRow key={m.id} memory={m} onUpdate={update} onDelete={() => handleDelete(m.id)} />
          ))}
        </div>
      </main>
    </div>
  );
}

function MemoryRow({
  memory,
  onUpdate,
  onDelete,
}: {
  memory: MemoryDTO;
  onUpdate: (id: string, text: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.memory);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await onUpdate(memory.id, text.trim());
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update memory");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="group flex items-start gap-2 rounded-lg border border-border bg-card/40 p-3">
      <div className="min-w-0 flex-1">
        {editing ? (
          <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[44px] resize-none text-sm" autoFocus />
        ) : (
          <p className="text-sm">{memory.memory}</p>
        )}
        <div className="mt-1.5 flex items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            {memory.source === "MANUAL" ? "Added by you" : "Learned"}
          </Badge>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
        {editing ? (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                setEditing(false);
                setText(memory.memory);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
