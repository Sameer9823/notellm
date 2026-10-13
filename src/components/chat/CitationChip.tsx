"use client";

import { ExternalLink } from "lucide-react";
import { sourceTypeIcon, formatTimestamp } from "@/lib/source-meta";
import type { Citation } from "@/types";

export function CitationChip({ citation, onOpen }: { citation: Citation; onOpen: (c: Citation) => void }) {
  const Icon = sourceTypeIcon[citation.sourceType];
  const locator =
    citation.page != null
      ? `p. ${citation.page}`
      : citation.startSec != null
      ? formatTimestamp(citation.startSec)
      : null;

  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-2 py-1 text-left text-xs">
      <button
        onClick={() => onOpen(citation)}
        className="flex flex-1 items-center gap-1.5 text-left transition-colors hover:text-foreground"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/20 font-mono text-[10px] font-semibold text-primary">
          {citation.marker}
        </span>
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="max-w-[10rem] truncate text-muted-foreground hover:text-foreground">{citation.sourceTitle}</span>
        {locator && <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">{locator}</span>}
      </button>

      {citation.url && (
        <a
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="rounded p-0.5 text-muted-foreground/70 hover:text-foreground hover:bg-secondary"
          title="Open in new tab"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
