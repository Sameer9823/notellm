export type InlineFormat = {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  underline?: boolean;
};

export type InlineNode =
  | ({ type: "text" } & InlineFormat & { text: string })
  | { type: "link"; href: string; children: InlineNode[]; title?: string }
  | { type: "image"; src: string; alt: string; title?: string }
  | { type: "footnote-ref"; id: number };

export type ParagraphAlign = "left" | "center" | "right" | "justify" | undefined;

export type HeadingBlock = {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  inline: InlineNode[];
};

export type ParagraphBlock = {
  type: "paragraph";
  inline: InlineNode[];
  align?: ParagraphAlign;
  quote?: boolean;
};

export type CodeBlock = {
  type: "code";
  text: string;
  language?: string;
};

export type ListItem = {
  inline: InlineNode[];
  children: Block[];
};

export type ListBlock = {
  type: "list";
  ordered: boolean;
  start?: number;
  items: ListItem[];
};

export type TableBlock = {
  type: "table";
  columns: number;
  header?: InlineNode[][];
  rows: InlineNode[][][];
  aligns?: ("left" | "center" | "right" | "justify" | null)[];
};

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | CodeBlock
  | ListBlock
  | TableBlock;

export type Reference = {
  id: number;
  sourceTitle: string;
  sourceType: string;
  locator?: string;
  originUrl?: string | null;
};

export type Section = {
  key: string;
  title: string;
  blocks: Block[];
};

export type ExportDocument = {
  title: string;
  author?: string;
  metadata: Record<string, string>;
  sections: Section[];
  references?: Reference[];
};

export type ExportOptions = {
  sections: string[];
  includeChat: boolean;
  includeCitations: boolean;
  includeSourceText: boolean;
  includeAISummary: boolean;
  includeMemory: boolean;
};

export const ALL_SECTION_KEYS = [
  "sources",
  "notes",
  "summary",
  "roadmap",
  "flashcards",
  "audio",
  "chat",
  "memory",
  "appendix",
] as const;

export type SectionKey = (typeof ALL_SECTION_KEYS)[number];

