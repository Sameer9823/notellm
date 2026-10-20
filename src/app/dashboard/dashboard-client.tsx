"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser, UserButton } from "@clerk/nextjs";
import { motion } from "framer-motion";
import {
  Plus,
  Sparkles,
  GraduationCap,
  Brain,
  CreditCard,
  Search,
  Library,
  X,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { NotebookCard } from "@/components/notebook/NotebookCard";
import { NotebookFormDialog } from "@/components/notebook/NotebookFormDialog";
import { ExportAllDialog } from "@/components/notebook/ExportAllDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { CreditsBadge } from "@/components/shared/CreditsBadge";
import { useCredits } from "@/hooks/use-credits";
import { toast } from "sonner";
import type { NotebookDTO } from "@/types";
import { ThemeToggle } from "@/components/theme-toggle";
import { Empty } from "@/components/ui/empty";

export function DashboardClient() {
  const { user } = useUser();
  const { credits, loading: creditsLoading } = useCredits();
  const [notebooks, setNotebooks] = useState<NotebookDTO[] | null>(null);
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NotebookDTO | null>(null);
  const [deleting, setDeleting] = useState<NotebookDTO | null>(null);
  const [exportAllOpen, setExportAllOpen] = useState(false);
  const [exportAllLoading, setExportAllLoading] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/notebooks");
      if (!res.ok) {
        setNotebooks([]);
        return;
      }
      const data = await res.json();
      setNotebooks(data.notebooks ?? []);
    } catch {
      setNotebooks([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/notebooks/${deleting.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Notebook deleted");
      setDeleting(null);
      load();
    } catch {
      toast.error("Couldn't delete notebook");
    }
  }

  async function handleExportAll() {
    setExportAllLoading(true);
    try {
      const res = await fetch("/api/export/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "pdf",
          sections: ["sources", "notes", "summary", "roadmap", "flashcards", "audio", "appendix"],
          includeChat: false,
          includeCitations: true,
          includeSourceText: false,
          includeAISummary: false,
          includeMemory: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        throw new Error(err.error);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `footnote-export-all-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Exported all notebooks");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportAllLoading(false);
      setExportAllOpen(false);
    }
  }

  const totalSources = useMemo(
    () =>
      notebooks?.reduce((sum, nb) => sum + (nb._count?.sources ?? 0), 0) ?? 0,
    [notebooks],
  );

  const filtered = useMemo(() => {
    if (!notebooks) return null;
    const q = query.trim().toLowerCase();
    if (!q) return notebooks;
    return notebooks.filter(
      (nb) =>
        nb.title.toLowerCase().includes(q) ||
        nb.description?.toLowerCase().includes(q),
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Review"
                >
                  <GraduationCap className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/dashboard/memory">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Memory"
                >
                  <Brain className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/dashboard/billing">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Billing"
                >
                  <CreditCard className="h-4 w-4" />
                </Button>
              </Link>
            </div>
            <CreditsBadge credits={credits} loading={creditsLoading} />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExportAllOpen(true)}
              title="Export all notebooks"
              disabled={exportAllLoading || !notebooks?.length}
            >
              <Download className="h-4 w-4" />
            </Button>
            <ThemeToggle />
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold sm:text-2xl">
              Your notebooks
            </h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              Each notebook is an isolated knowledge base — its own sources, its
              own answers.
              {!!notebooks?.length && (
                <span className="hidden items-center gap-1 whitespace-nowrap text-muted-foreground sm:inline-flex">
                  · <Library className="h-3 w-3" /> {notebooks.length}{" "}
                  {notebooks.length === 1 ? "notebook" : "notebooks"},{" "}
                  {totalSources} {totalSources === 1 ? "source" : "sources"}
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
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}

          {notebooks?.length === 0 && (
            <Empty
              className="col-span-full"
              icon={<Sparkles className="h-8 w-8" />}
              title="No notebooks yet"
              description="Create one to start uploading sources and asking grounded questions."
              action={
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="h-4 w-4" /> Create your first notebook
                </Button>
              }
            />
          )}

          {!!notebooks?.length && filtered?.length === 0 && (
            <Empty
              className="col-span-full"
              icon={<Search className="h-6 w-6" />}
              title="No matching notebooks"
              description={`No notebooks match &ldquo;{query}&rdquo;.`}
            />
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

      <NotebookFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        notebook={editing}
        onSaved={load}
      />

      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{deleting?.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently removes all sources, chunks, and chat history in
              this notebook. This can&apos;t be undone.
            </DialogDescription>
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

      <ExportAllDialog open={exportAllOpen} onOpenChange={setExportAllOpen} onExportAll={handleExportAll} loading={exportAllLoading} />
    </div>
  );
}
