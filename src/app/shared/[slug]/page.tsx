"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { sourceTypeIcon, sourceTypeLabel, formatTimestamp } from "@/lib/source-meta";
import type { Citation, SourceType } from "@/types";

type PublicSource = {
  id: string;
  type: SourceType;
  title: string;
  originUrl: string | null;
  pageCount: number | null;
  durationSec: number | null;
  chunkCount: number;
};

type PublicMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  citations: Citation[] | null;
  createdAt: string;
};

type PublicNotebook = {
  id: string;
  title: string;
  description: string | null;
  updatedAt: string;
  sources: PublicSource[];
  messages: PublicMessage[];
};

function citationLabel(c: Citation) {
  if (c.page != null) return `p.${c.page}`;
  if (c.startSec != null) return formatTimestamp(c.startSec);
  return c.sourceTitle;
}

export default function SharedNotebookPage() {
  const { slug } = useParams<{ slug: string }>();
  const [notebook, setNotebook] = useState<PublicNotebook | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/public/notebooks/${slug}`)
      .then((res) => {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then((data) => setNotebook(data.notebook))
      .catch(() => setNotFound(true));
  }, [slug]);

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <Logo className="h-8 w-8 text-muted-foreground" />
        <h1 className="font-display text-lg font-semibold">This notebook isn&apos;t shared</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The link may be wrong, or the owner has turned off sharing for this notebook.
        </p>
        <Link href="/" className="mt-2 text-sm text-primary hover:underline">
          Go to Footnote
        </Link>
      </div>
    );
  }

  if (!notebook) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="mt-4 h-24 w-full" />
        <Skeleton className="mt-4 h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-1.5 font-display text-sm font-semibold">
            <Logo className="h-4 w-4 text-primary" />
            Footnote
          </Link>
          <span className="rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 text-[11px] text-muted-foreground">
            Read-only shared view
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="font-display text-2xl font-semibold">{notebook.title}</h1>
        {notebook.description && <p className="mt-1 text-sm text-muted-foreground">{notebook.description}</p>}

        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sources ({notebook.sources.length})
          </h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {notebook.sources.map((s) => {
              const Icon = sourceTypeIcon[s.type];
              return (
                <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 text-sm">
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{s.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{sourceTypeLabel[s.type]}</span>
                </div>
              );
            })}
          </div>
        </section>

        {notebook.messages.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversation</h2>
            <div className="mt-3 space-y-5">
              {notebook.messages.map((m) => (
                <div key={m.id} className="flex gap-2.5">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary/60">
                    {m.role === "USER" ? (
                      <User className="h-3.5 w-3.5" />
                    ) : (
                      <Logo className="h-3.5 w-3.5 text-primary" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {m.citations.map((c, i) => (
                          <span
                            key={`${c.chunkId}-${i}`}
                            className="rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                            title={c.snippet}
                          >
                            {c.sourceTitle} · {citationLabel(c)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}