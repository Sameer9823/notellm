import { marked } from "marked";
import type {
  InlineNode,
  HeadingBlock,
  ParagraphBlock,
  CodeBlock,
  ListBlock,
  TableBlock,
  Block,
  ListItem,
  InlineFormat,
  ParagraphAlign,
} from "./types";

marked.use({ gfm: true, breaks: true });

type MarkedToken =
  | { type: "heading"; depth: number; text: string; tokens: MarkedInlineToken[]; raw: string }
  | { type: "paragraph"; text: string; tokens: MarkedInlineToken[]; raw: string }
  | { type: "code"; lang: string; text: string; raw: string }
  | { type: "list"; ordered: boolean; start: number; loose: boolean; items: MarkedListItem[]; raw: string }
  | { type: "list_item"; task: boolean; checked?: boolean; loose: boolean; text: string; tokens: MarkedToken[]; raw: string }
  | { type: "blockquote"; tokens: MarkedToken[]; text: string; raw: string }
  | { type: "table"; header: MarkedTableCell[]; rows: MarkedTableCell[][]; align: (string | null)[]; raw: string }
  | { type: "space"; raw: string }
  | { type: "hr"; raw: string }
  | { type: "html"; text: string; raw: string }
  | { type: "text"; text: string; tokens?: MarkedInlineToken[]; raw: string };

type MarkedInlineToken =
  | { type: "text"; text: string; raw: string; escaped: boolean; tokens?: MarkedInlineToken[] }
  | { type: "codespan"; text: string; raw: string }
  | { type: "strong"; text: string; raw: string; tokens: MarkedInlineToken[] }
  | { type: "em"; text: string; raw: string; tokens: MarkedInlineToken[] }
  | { type: "del"; text: string; raw: string; tokens: MarkedInlineToken[] }
  | { type: "link"; href: string; title: string | null; text: string; tokens: MarkedInlineToken[] }
  | { type: "image"; href: string; title: string | null; text: string; tokens: MarkedInlineToken[] }
  | { type: "br"; raw: string }
  | { type: "escape"; text: string; raw: string };

type MarkedListItem = {
  type: "list_item";
  task: boolean;
  checked?: boolean;
  loose: boolean;
  text: string;
  tokens: MarkedToken[];
  raw: string;
};

type MarkedTableCell = {
  text: string;
  tokens: MarkedInlineToken[];
  header: boolean;
  align: string | null;
};

function toInline(tokens: MarkedInlineToken[], inherited: InlineFormat = {}): InlineNode[] {
  const out: InlineNode[] = [];

  for (const t of tokens) {
    switch (t.type) {
      case "text": {
        const fmt = inherited as InlineFormat;
        const run: InlineNode = { type: "text", text: t.text, ...fmt };
        if (out.length > 0 && out[out.length - 1].type === "text" && sameFormat(out[out.length - 1], fmt)) {
          (out[out.length - 1] as Extract<InlineNode, { type: "text" }>).text += t.text;
        } else {
          out.push(run);
        }
        break;
      }
      case "escape": {
        const fmt = inherited as InlineFormat;
        const run: InlineNode = { type: "text", text: t.text, ...fmt };
        if (out.length > 0 && out[out.length - 1].type === "text" && sameFormat(out[out.length - 1], fmt)) {
          (out[out.length - 1] as Extract<InlineNode, { type: "text" }>).text += t.text;
        } else {
          out.push(run);
        }
        break;
      }
      case "codespan": {
        out.push({ type: "text" as const, text: t.text, ...(inherited as InlineFormat), code: true });
        break;
      }
      case "strong": {
        out.push(...toInline(t.tokens, { ...inherited, bold: true }));
        break;
      }
      case "em": {
        out.push(...toInline(t.tokens, { ...inherited, italic: true }));
        break;
      }
      case "del": {
        out.push(...toInline(t.tokens, { ...inherited, strike: true }));
        break;
      }
      case "link": {
        out.push({
          type: "link" as const,
          href: t.href,
          title: t.title || undefined,
          children: toInline(t.tokens, inherited),
        });
        break;
      }
      case "image": {
        out.push({ type: "image" as const, src: t.href, alt: t.text, title: t.title || undefined });
        break;
      }
      case "br": {
        out.push({ type: "text" as const, text: "\n", ...(inherited as InlineFormat) });
        break;
      }
      default: {
        if ("text" in t) {
          const txt = (t as { text?: string }).text;
          if (txt) out.push({ type: "text" as const, text: txt, ...(inherited as InlineFormat) });
        }
      }
    }
  }
  return out;
}

function sameFormat(node: InlineNode, fmt: InlineFormat): boolean {
  if (node.type !== "text") return false;
  return (
    node.bold === fmt.bold &&
    node.italic === fmt.italic &&
    node.code === fmt.code &&
    node.strike === fmt.strike &&
    node.underline === fmt.underline
  );
}

function paragraphBlock(inline: InlineNode[], quote = false, align?: ParagraphAlign): ParagraphBlock {
  return { type: "paragraph" as const, inline, quote, align };
}

function toBlocks(tokens: MarkedToken[], quote = false): Block[] {
  const blocks: Block[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const level = Math.min(Math.max(t.depth, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6;
        blocks.push({ type: "heading" as const, level, inline: toInline(t.tokens) });
        break;
      }
      case "paragraph": {
        blocks.push(paragraphBlock(toInline(t.tokens), quote));
        break;
      }
      case "code": {
        blocks.push({ type: "code" as const, text: t.text, language: t.lang || undefined });
        break;
      }
      case "list": {
        const items: ListItem[] = t.items.map((item) => listItemToItem(item, quote));
        blocks.push({ type: "list" as const, ordered: t.ordered, start: t.start, items });
        break;
      }
      case "blockquote": {
        blocks.push(...toBlocks(t.tokens, true));
        break;
      }
      case "table": {
        blocks.push(tableToBlock(t));
        break;
      }
      case "space":
      case "hr":
      case "html":
        break;
      default:
        break;
    }
  }
  return blocks;
}

function listItemToItem(item: MarkedListItem, quote: boolean): ListItem {
  let inline: InlineNode[] = [];
  const children: Block[] = [];
  let firstInline = true;

  for (const t of item.tokens ?? []) {
    if (t.type === "text" && t.tokens?.length) {
      const runs = toInline(t.tokens);
      if (firstInline) {
        inline = runs;
        firstInline = false;
      } else {
        children.push(paragraphBlock(runs, quote));
      }
    } else if (t.type === "paragraph") {
      const runs = toInline(t.tokens ?? []);
      if (firstInline) {
        inline = runs;
        firstInline = false;
      } else {
        children.push(paragraphBlock(runs, quote));
      }
    } else if (t.type === "list") {
      children.push({ type: "list" as const, ordered: t.ordered, start: t.start, items: t.items.map((i) => listItemToItem(i, quote)) });
    } else if (t.type === "code") {
      children.push({ type: "code" as const, text: t.text, language: t.lang });
    }
  }

  if (item.task && inline.length > 0) {
    const marker = item.checked ? "☑ " : "☐ ";
    inline = [{ type: "text" as const, text: marker, bold: true }, ...inline];
  }
  return { inline, children };
}

function tableToBlock(table: MarkedToken & { type: "table" }): TableBlock {
  const header: InlineNode[][] = table.header.map((cell) => toInline(cell.tokens));
  const rows: InlineNode[][][] = table.rows.map((row) => row.map((cell) => toInline(cell.tokens)));
  const aligns: ("left" | "center" | "right" | "justify" | null)[] = table.align.map((a) => {
    if (a === "left") return "left" as const;
    if (a === "center") return "center" as const;
    if (a === "right") return "right" as const;
    if (a === "justify") return "justify" as const;
    return null;
  });
  return {
    type: "table" as const,
    columns: table.header.length,
    header,
    rows,
    aligns,
  };
}

export function markdownToBlocks(md: string): Block[] {
  if (!md?.trim()) return [];
  const tokens = marked.lexer(md) as MarkedToken[];
  return toBlocks(tokens);
}

const LIST_LIKE: RegExp = /^\s*(\d+)\.\s?|^\s*[-*+]\s|[•‣⁃]/;

function normalizeListLine(line: string): string {
  return line
    .replace(/[•‣⁃]/g, "•")
    .replace(/(\d+)\.([A-Za-z])/g, "$1. $2")
    .replace(/(^\s*)•[ \t]*/g, "$1- ")
    .replace(/([^\n])[ \t]*•[ \t]*/g, "$1\n- ")
    .replace(/([^\n])\s+(?=\d+\.\s)/g, "$1\n");
}

export function normalizeContent(md: string): string {
  if (!md) return md;
  const normalized = md.replace(/\r\n/g, "\n");
  const tokens = normalized.split(/(```[\s\S]*?```|`[^`]*`)/g);
  const out = tokens.map((t, i) => {
    if (i % 2 === 1) return t;
    return t
      .split(/\n/)
      .map((line) => (LIST_LIKE.test(line) ? normalizeListLine(line) : line))
      .join("\n");
  });
  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}

export function markdownToSection(md: string, key: string, title: string) {
  const blocks = markdownToBlocks(md);
  if (blocks.length === 0) return null;
  return { key, title, blocks };
}