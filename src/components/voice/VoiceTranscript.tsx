"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { TranscriptEntry } from "@/lib/voice/types";
import { CitationChip } from "@/components/chat/CitationChip";

export interface VoiceTranscriptProps {
  entries: TranscriptEntry[];
  agentName: string;
  actions?: ReactNode;
  composer?: ReactNode;
  onOpenCitation?: (citation: { sourceId: string; chunkId: string; sourceTitle: string; sourceType: string; page?: number | null; startSec?: number | null; endSec?: number | null; snippet: string; url?: string | null; marker: number }) => void;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function VoiceTranscript({ entries, agentName, actions, composer, onOpenCitation }: VoiceTranscriptProps) {
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
      const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
      pinnedToBottomRef.current = distanceFromBottom < 48;
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section aria-labelledby="conversation-heading">
      <header>
        <h2 id="conversation-heading">Conversation</h2>
        {actions && <div>{actions}</div>}
      </header>

      <div ref={listRef} role="log" aria-live="polite" aria-label="Conversation transcript" tabIndex={0}>
        {entries.length === 0 ? (
          <p>Start a conversation and say something out loud.</p>
        ) : (
          entries.map((entry) => (
            <article key={entry.id} className={entry.status === "interrupted" ? "interrupted" : ""}>
              <header>
                <span>{entry.role === "user" ? "You" : agentName}</span>
                <time dateTime={new Date(entry.startedAt).toISOString()} suppressHydrationWarning>
                  {formatTime(entry.startedAt)}
                </time>
                {entry.status === "interrupted" && <span>Interrupted</span>}
              </header>
              <p>
                {entry.text || <span>{entry.status === "streaming" ? "…" : ""}</span>}
                {entry.status === "interrupted" && <span>…</span>}
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
                        sourceType: c.sourceType as "PDF" | "TEXT" | "URL" | "YOUTUBE" | "VTT" | "WEB",
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
            </article>
          ))
        )}
      </div>

      {composer}
    </section>
  );
}
