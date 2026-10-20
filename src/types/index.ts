export type SourceType = "PDF" | "TEXT" | "URL" | "YOUTUBE" | "VTT" | "WEB";
export type SourceStatus = "UPLOADING" | "QUEUED" | "INDEXING" | "READY" | "FAILED";

export type SourceDTO = {
  id: string;
  notebookId: string;
  type: SourceType;
  title: string;
  status: SourceStatus;
  errorMessage?: string | null;
  originUrl?: string | null;
  chunkCount: number;
  pageCount?: number | null;
  durationSec?: number | null;
  /** ISO 639-1-ish code of the source's original spoken/written language
   *  (e.g. "hi"), set when it differs from English and the transcript was
   *  auto-translated. Null/undefined for English-language sources. */
  language?: string | null;
  createdAt: string;
  indexedAt?: string | null;
};

export type NotebookDTO = {
  id: string;
  title: string;
  description?: string | null;
  icon: string;
  color: string;
  isPublic?: boolean;
  shareSlug?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { sources: number };
};

export type Citation = {
  marker: number;
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: SourceType;
  page?: number | null;
  startSec?: number | null;
  endSec?: number | null;
  snippet: string;
  /** Set only for sourceType "WEB" (live web-search results, not a notebook
   *  source) — the chip opens this directly in a new tab instead of the
   *  in-app source viewer, since there's no indexed chunk to show. */
  url?: string | null;
};

export type MessageDTO = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  citations?: Citation[] | null;
  createdAt: string;
  /** null = the notebook's "All sources" chat; set to a source id for that
   *  source's own independent chat thread. */
  sourceId: string | null;
};

export type AudioStatus = "QUEUED" | "SCRIPTING" | "SYNTHESIZING" | "READY" | "FAILED";

export type AudioScriptLine = { speaker: "A" | "B"; text: string };

export type AudioOverviewDTO = {
  id: string;
  status: AudioStatus;
  errorMessage?: string | null;
  script?: AudioScriptLine[] | null;
  durationSec?: number | null;
  createdAt: string;
  sourceId?: string | null;
  sourceTitle?: string | null;
  hasAudio: boolean;
};

export type RoadmapStatus = "QUEUED" | "CLUSTERING" | "LABELING" | "ORDERING" | "READY" | "FAILED";

export type RoadmapNodeDTO = {
  id: string;
  order: number;
  label: string;
  summary: string;
  keywords: string[];
  chunkCount: number;
  videos: { sourceId: string; title: string; originUrl: string | null; timestamps: number[] }[];
};

export type RoadmapEdgeDTO = { from: string; to: string };

export type RoadmapDTO = {
  id: string;
  status: RoadmapStatus;
  errorMessage?: string | null;
  nodes?: RoadmapNodeDTO[] | null;
  edges?: RoadmapEdgeDTO[] | null;
  sourceCount: number;
  createdAt: string;
};

export type NoteDTO = {
  id: string;
  notebookId: string;
  content: string;
  citations?: Citation[] | null;
  createdAt: string;
};