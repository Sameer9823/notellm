"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { TranscriptEntry } from "@/lib/voice/types";
import { CitationChip } from "@/components/chat/CitationChip";

export interface VoiceTranscriptProps {
  entries: TranscriptEntry[];
  agentName: string;
  actions?: ReactNode;
  composer?: ReactNode;
  onOpenCitation?: (citation: {
    sourceId: string;
    chunkId: string;
    sourceTitle: string;
    sourceType: string;
    page?: number | null;
    startSec?: number | null;
    endSec?: number | null;
    snippet: string;
    url?: string | null;
    marker: number;
  }) => void;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VoiceTranscript({
  entries,
  agentName,
  actions,
  composer,
  onOpenCitation,
}: VoiceTranscriptProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !pinnedToBottomRef.current) return;
    list.scrollTop = list.scrollHeight;
  }, [entries]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => {
      const distanceFromBottom =
        list.scrollHeight - list.scrollTop - list.clientHeight;
      pinnedToBottomRef.current = distanceFromBottom < 48;
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section
      aria-labelledby="conversation-heading"
      className="flex-1 overflow-auto"
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2 mb-3">
        <h2
          id="conversation-heading"
          className="text-xs font-semibold text-muted-foreground"
        >
          Conversation
        </h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation transcript"
        tabIndex={0}
        className="px-3 pb-3 space-y-4"
      >
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center text-muted-foreground">
            <p className="text-sm">
              Start a conversation and say something out loud.
            </p>
          </div>
        ) : (
          entries.map((entry) => (
            <article
              key={entry.id}
              className={cn(
                "flex gap-2.5 animate-in fade-in-0 slide-in-from-bottom-2",
                entry.status === "interrupted" && "opacity-60",
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  entry.role === "user"
                    ? "bg-secondary text-foreground"
                    : "bg-primary/15 text-primary",
                )}
                aria-hidden="true"
              >
                {entry.role === "user" ? (
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                ) : (
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <header className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-foreground">
                    {entry.role === "user" ? "You" : agentName}
                  </span>
                  <time
                    dateTime={new Date(entry.startedAt).toISOString()}
                    className="text-[10px] text-muted-foreground"
                    suppressHydrationWarning
                  >
                    {formatTime(entry.startedAt)}
                  </time>
                  {entry.status === "interrupted" && (
                    <span className="text-[10px] text-amber-500">
                      Interrupted
                    </span>
                  )}
                  {entry.status === "streaming" && (
                    <span className="text-[10px] text-primary animate-pulse">
                      ●
                    </span>
                  )}
                </header>
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                  {entry.text || (entry.status === "streaming" ? "…" : "")}
                  {entry.status === "interrupted" && (
                    <span className="text-muted-foreground">…</span>
                  )}
                </p>
                {entry.role === "assistant" && entry.citations?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entry.citations.map((c) => (
                      <CitationChip
                        key={`${c.marker}-${c.chunkId}`}
                        citation={{
                          marker: c.marker,
                          chunkId: c.chunkId,
                          sourceId: c.sourceId,
                          sourceTitle: c.sourceTitle,
                          sourceType: c.sourceType as
                            "PDF" | "TEXT" | "URL" | "YOUTUBE" | "VTT" | "WEB",
                          page: c.page ?? null,
                          startSec: c.startSec ?? null,
                          endSec: c.endSec ?? null,
                          snippet: c.snippet,
                          url: c.url ?? null,
                        }}
                        onOpen={(citation) => {
                          onOpenCitation?.({
                            marker: citation.marker,
                            chunkId: citation.chunkId,
                            sourceId: citation.sourceId,
                            sourceTitle: citation.sourceTitle,
                            sourceType: citation.sourceType,
                            page: citation.page,
                            startSec: citation.startSec,
                            endSec: citation.endSec,
                            snippet: citation.snippet,
                            url: citation.url,
                          });
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>

      {composer}
    </section>
  );
}
