"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser, UserButton } from "@clerk/nextjs";
import { motion } from "framer-motion";
import { Plus, Sparkles, GraduationCap, Brain, CreditCard, Search, Library, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { NotebookCard } from "@/components/notebook/NotebookCard";
import { NotebookFormDialog } from "@/components/notebook/NotebookFormDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CreditsBadge } from "@/components/shared/CreditsBadge";
import { useCredits } from "@/hooks/use-credits";
import { toast } from "sonner";
import type { NotebookDTO } from "@/types";

export default function DashboardPage() {
  const { user } = useUser();
  const { credits, loading: creditsLoading } = useCredits();
  const [notebooks, setNotebooks] = useState<NotebookDTO[] | null>(null);
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NotebookDTO | null>(null);
  const [deleting, setDeleting] = useState<NotebookDTO | null>(null);

  async function load() {
    const res = await fetch("/api/notebooks");
    const data = await res.json();
    setNotebooks(data.notebooks);
  }

  useEffect(() => {
    load();
  }, []);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/notebooks/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Notebook deleted");
      setDeleting(null);
      load();
    } catch {
      toast.error("Couldn't delete notebook");
    }
  }

  const totalSources = useMemo(
    () => notebooks?.reduce((sum, nb) => sum + (nb._count?.sources ?? 0), 0) ?? 0,
    [notebooks]
  );

  const filtered = useMemo(() => {
    if (!notebooks) return null;
    const q = query.trim().toLowerCase();
    if (!q) return notebooks;
    return notebooks.filter(
      (nb) => nb.title.toLowerCase().includes(q) || nb.description?.toLowerCase().includes(q)
    );
  }, [notebooks, query]);

  return (
    <div className="min-h-screen bg-grid">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2 font-display text-lg font-semibold">
            <Logo className="h-5 w-5 text-primary" />
            Footnote
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="hidden pr-1 text-sm text-muted-foreground md:inline">
              {user?.firstName ? `Welcome, ${user.firstName}` : ""}
            </span>
            <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-secondary/20 p-0.5">
              <Link href="/dashboard/review">
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Review">
                  <GraduationCap className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/dashboard/memory">
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Memory">
                  <Brain className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/dashboard/billing">
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Billing">
                  <CreditCard className="h-4 w-4" />
                </Button>
              </Link>
            </div>
            <CreditsBadge credits={credits} loading={creditsLoading} />
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold sm:text-2xl">Your notebooks</h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              Each notebook is an isolated knowledge base — its own sources, its own answers.
              {!!notebooks?.length && (
                <span className="hidden items-center gap-1 whitespace-nowrap text-muted-foreground/70 sm:inline-flex">
                  · <Library className="h-3 w-3" /> {notebooks.length} {notebooks.length === 1 ? "notebook" : "notebooks"}, {totalSources}{" "}
                  {totalSources === 1 ? "source" : "sources"}
                </span>
              )}
            </p>
          </div>
          <Button
            className="w-full shrink-0 sm:w-auto"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New notebook
          </Button>
        </div>

        {!!notebooks?.length && (
          <div className="relative mt-6 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notebooks…"
              className="h-9 pl-8 pr-8 text-sm"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notebooks === null &&
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}

          {notebooks?.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="col-span-full flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center"
            >
              <Sparkles className="h-8 w-8 text-muted-foreground/50" />
              <div>
                <h3 className="font-display text-base font-semibold">No notebooks yet</h3>
                <p className="mt-1 text-sm text-muted-foreground">Create one to start uploading sources and asking grounded questions.</p>
              </div>
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" /> Create your first notebook
              </Button>
            </motion.div>
          )}

          {!!notebooks?.length && filtered?.length === 0 && (
            <div className="col-span-full flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
              <Search className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No notebooks match &ldquo;{query}&rdquo;.</p>
            </div>
          )}

          {filtered?.map((nb) => (
            <NotebookCard
              key={nb.id}
              notebook={nb}
              onRename={() => {
                setEditing(nb);
                setFormOpen(true);
              }}
              onDelete={() => setDeleting(nb)}
            />
          ))}
        </div>
      </main>

      <NotebookFormDialog open={formOpen} onOpenChange={setFormOpen} notebook={editing} onSaved={load} />

      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{deleting?.title}&rdquo;?</DialogTitle>
            <DialogDescription>This permanently removes all sources, chunks, and chat history in this notebook. This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete notebook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}