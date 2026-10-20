import { db } from "@/lib/db";
import type { ExportDocument, ExportOptions, SectionKey, Section, Reference } from "./types";
import { markdownToSection, normalizeContent } from "./markdown";
import { formatTimestamp } from "@/lib/source-meta";
import type { InlineNode, Block } from "./types";

const MAX_MESSAGES = 500;
const MAX_REVIEW_CARDS = 200;
const MAX_NOTES = 200;
const MAX_SOURCES = 100;

export async function buildExportDocument(
  notebookId: string,
  userId: string,
  authorName: string | null,
  opts: ExportOptions
): Promise<ExportDocument | null> {
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    select: { id: true, title: true, description: true, ownerId: true, createdAt: true },
  });
  if (!notebook || notebook.ownerId !== userId) return null;

  const [
    sources,
    notes,
    artifacts,
    roadmap,
    audioOverview,
    messages,
    reviewCards,
    memories,
  ] = await Promise.all([
    db.source.findMany({
      where: { notebookId, status: "READY" },
      take: MAX_SOURCES,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        title: true,
        status: true,
        originUrl: true,
        pageCount: true,
        durationSec: true,
        chunkCount: true,
        metadata: true,
      },
    }),
    db.note.findMany({
      where: { notebookId },
      take: MAX_NOTES,
      orderBy: { createdAt: "asc" },
      select: { id: true, content: true, citations: true, createdAt: true },
    }),
    db.artifact.findMany({
      where: { notebookId, status: "READY" },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, title: true, content: true, createdAt: true },
    }),
    db.roadmap.findFirst({
      where: { notebookId, status: "READY" },
      orderBy: { createdAt: "desc" },
      select: { id: true, nodes: true, edges: true, createdAt: true },
    }),
    db.audioOverview.findFirst({
      where: { notebookId, status: "READY" },
      orderBy: { createdAt: "desc" },
      select: { id: true, script: true, sourceId: true, sourceTitle: true, createdAt: true },
    }),
    opts.includeChat
      ? db.message.findMany({
          where: { notebookId },
          take: MAX_MESSAGES,
          orderBy: { createdAt: "asc" },
          select: { id: true, role: true, content: true, citations: true, createdAt: true },
        })
      : Promise.resolve([] as { id: string; role: "USER" | "ASSISTANT"; content: string; citations: unknown; createdAt: Date }[]),
    opts.sections.includes("flashcards")
      ? db.reviewCard.findMany({
          where: { notebookId },
          take: MAX_REVIEW_CARDS,
          orderBy: { createdAt: "asc" },
          select: { id: true, front: true, back: true, options: true, correctIndex: true, explanation: true, artifactId: true, cardType: true },
        })
      : Promise.resolve([] as { id: string; front: string; back: string; options: string[]; correctIndex: number | null; explanation: string | null; artifactId: string; cardType: "FLASHCARD" | "QUIZ" }[]),
    opts.includeMemory
      ? db.userMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 100 })
      : Promise.resolve([] as { id: string; memory: string; source: "MANUAL" | "LEARNED"; metadata: unknown }[]),
  ]);

  const author = authorName ?? "Unknown";

  const exportDate = new Date().toLocaleString();
  const sourceCount = sources.length;
  const references: Reference[] = [];
  let refCounter = 0;

  const getRefId = (citation: { sourceTitle: string; sourceType: string; page?: number | null; startSec?: number | null; endSec?: number | null }): number => {
    refCounter++;
    references.push({
      id: refCounter,
      sourceTitle: citation.sourceTitle,
      sourceType: citation.sourceType,
      locator: citation.page != null ? `p. ${citation.page}` : citation.startSec != null ? formatTimestamp(citation.startSec) : undefined,
    });
    return refCounter;
  };

  const sections: ExportDocument["sections"] = [];

  if (opts.sections.includes("sources") && sources.length > 0) {
    const blocks: ExportDocument["sections"][0]["blocks"] = [];
    const header: string[][] = [["Title", "Type", "Status", "Pages / Duration", "Origin"]];
    const rows: string[][] = sources.map((s: { title: string; type: string; status: string; pageCount: number | null; durationSec: number | null; chunkCount: number; originUrl: string | null }) => {
      let locator = "";
      if (s.pageCount != null) locator = `${s.pageCount} pages`;
      else if (s.durationSec != null) locator = formatTimestamp(s.durationSec);
      else locator = `${s.chunkCount} chunks`;
      return [
        s.title,
        s.type,
        s.status,
        locator,
        s.originUrl ?? "",
      ];
    });
    blocks.push({
      type: "table" as const,
      columns: 5,
      header: header.map((row) => row.map((c) => ({ type: "text" as const, text: c, bold: true }))),
      rows: rows.map((row) => row.map((c) => [{ type: "text" as const, text: c }])),
    });
    sections.push({ key: "sources", title: "Sources overview", blocks });
  }

  if (opts.sections.includes("notes") && notes.length > 0) {
    const blocks: ExportDocument["sections"][0]["blocks"] = [];
    for (const n of notes) {
      if (n.content?.trim()) {
        const sec = markdownToSection(n.content, `note-${n.id}`, "");
        if (sec) {
          blocks.push(...sec.blocks);
        }
        if (opts.includeCitations && n.citations && Array.isArray(n.citations) && n.citations.length > 0) {
          blocks.push({ type: "paragraph" as const, inline: [{ type: "text" as const, text: "Sources:", bold: true }] });
          const listItems: { inline: InlineNode[]; children: Block[] }[] = n.citations.map((c: unknown) => {
            const cit = c as { sourceTitle: string; sourceType: string; page?: number | null; startSec?: number | null };
            const refId = getRefId(cit);
            return {
               inline: [{ type: "footnote-ref" as const, id: refId }, { type: "text" as const, text: ` ${cit.sourceTitle} (${cit.sourceType})${cit.page != null ? ` p. ${cit.page}` : cit.startSec != null ? ` ${formatTimestamp(cit.startSec)}` : ""}` }],
              children: [],
            };
          });
        blocks.push({ type: "list" as const, ordered: false, items: listItems });
        }
      }
    }
    if (blocks.length > 0) sections.push({ key: "notes", title: "Notes", blocks });
  }

  if (opts.sections.includes("summary")) {
    const summaryArtifacts = artifacts.filter(
       (a: { type: string; content: unknown; id: string; title: string | null }) =>
        ["SUMMARY", "TAKEAWAYS", "REPORT"].includes(a.type) && a.content
    );
    if (summaryArtifacts.length > 0) {
      const blocks: ExportDocument["sections"][0]["blocks"] = [];
      for (const a of summaryArtifacts) {
        blocks.push({ type: "heading" as const, level: 2, inline: [{ type: "text" as const, text: a.title || a.type }] });
        const content = typeof a.content === "object" && a.content !== null && "markdown" in a.content
          ? String((a.content as { markdown?: string }).markdown || "")
          : typeof a.content === "object" && a.content !== null && "items" in a.content
            ? (a.content as { items?: string[] }).items?.join("\n\n") || ""
            : JSON.stringify(a.content);
        const sec = markdownToSection(normalizeContent(content), `summary-${a.id}`, "");
        if (sec) blocks.push(...sec.blocks);
      }
      sections.push({ key: "summary", title: "Summary / Key concepts", blocks });
    }
  }

  if (opts.sections.includes("roadmap") && roadmap?.nodes) {
    const blocks: ExportDocument["sections"][0]["blocks"] = [];
    const sorted = [...(roadmap.nodes as unknown as { id: string; order: number; label: string; summary: string; keywords: string[]; videos: { sourceId: string; title: string; timestamps: number[] }[] }[])].sort((a, b) => a.order - b.order);
    for (const n of sorted) {
      blocks.push({ type: "heading" as const, level: 3, inline: [{ type: "text" as const, text: `${n.order + 1}. ${n.label}` }] });
      if (n.summary) {
        const sec = markdownToSection(normalizeContent(n.summary), `roadmap-${n.id}-summary`, "");
        if (sec) blocks.push(...sec.blocks);
      }
      if (n.keywords?.length) {
        blocks.push({ type: "paragraph" as const, inline: [{ type: "text" as const, text: "Keywords: ", bold: true }, { type: "text" as const, text: n.keywords.join(", ") }] });
      }
      if (n.videos?.length) {
        const listItems = n.videos.map((v) => ({
          inline: [{ type: "text" as const, text: `${v.title} — ${v.timestamps.map(formatTimestamp).join(", ")}` }],
          children: [],
        }));
        blocks.push({ type: "list" as const, ordered: false, items: listItems });
      }
    }
    sections.push({ key: "roadmap", title: "Learning roadmap", blocks });
  }

  if (opts.sections.includes("flashcards") && reviewCards.length > 0) {
    const blocks: ExportDocument["sections"][0]["blocks"] = [];
    const byArtifact = new Map<string, typeof reviewCards>();
    for (const c of reviewCards) {
      const list = byArtifact.get(c.artifactId) || [];
      list.push(c);
      byArtifact.set(c.artifactId, list);
    }
    for (const [artifactId, cards] of byArtifact) {
      const artifact = artifacts.find((a: { id: string }) => a.id === artifactId);
      if (artifact) blocks.push({ type: "heading" as const, level: 3, inline: [{ type: "text" as const, text: artifact.title }] });
      for (const c of cards) {
        const q = c.front;
        const a = c.cardType === "FLASHCARD" ? c.back : c.options[c.correctIndex ?? 0] ?? c.back;
        blocks.push({ type: "paragraph" as const, inline: [{ type: "text" as const, text: `Q: ${q}`, bold: true }] });
        blocks.push({ type: "paragraph" as const, inline: [{ type: "text" as const, text: `A: ${a}` }] });
        if (c.explanation) {
          blocks.push({ type: "paragraph" as const, inline: [{ type: "text" as const, text: `Why: ${c.explanation}` }] });
        }
      }
    }
    sections.push({ key: "flashcards", title: "Flashcards / Review cards", blocks });
  }

  if (opts.sections.includes("audio") && audioOverview?.script) {
    const blocks: ExportDocument["sections"][0]["blocks"] = [];
    if (audioOverview.sourceId) {
      blocks.push({ type: "paragraph" as const, inline: [{ type: "text" as const, text: `Scoped to source: ${audioOverview.sourceTitle}`, italic: true }] });
    }
    for (const line of audioOverview.script as { speaker: "A" | "B"; text: string }[]) {
      blocks.push({
        type: "paragraph" as const,
        inline: [{ type: "text" as const, text: `Host ${line.speaker}: `, bold: true }, { type: "text" as const, text: line.text }],
      });
    }
    sections.push({ key: "audio", title: "Audio overview script", blocks });
  }

  if (opts.includeChat && messages.length > 0) {
    const blocks: ExportDocument["sections"][0]["blocks"] = [];
    for (const m of messages) {
      const role = m.role === "USER" ? "You" : "Assistant";
      blocks.push({ type: "heading" as const, level: 3, inline: [{ type: "text" as const, text: role }] });
      const sec = markdownToSection(normalizeContent(m.content), `msg-${m.id}`, "");
      if (sec) blocks.push(...sec.blocks);
      if (opts.includeCitations && m.citations && Array.isArray(m.citations) && m.citations.length > 0) {
        blocks.push({ type: "paragraph" as const, inline: [{ type: "text" as const, text: "Sources:", bold: true }] });
        const listItems = m.citations.map((c: unknown) => {
          const cit = c as { sourceTitle: string; sourceType: string; page?: number | null; startSec?: number | null };
          const refId = getRefId(cit);
          return {
            inline: [{ type: "footnote-ref" as const, id: refId }, { type: "text" as const, text: ` ${cit.sourceTitle} (${cit.sourceType})${cit.page != null ? ` p. ${cit.page}` : cit.startSec != null ? ` ${formatTimestamp(cit.startSec)}` : ""}` }],
            children: [],
          };
        });
        blocks.push({ type: "list" as const, ordered: false, items: listItems });
      }
    }
    sections.push({ key: "chat", title: "Chat history", blocks });
  }

  if (opts.includeMemory && memories.length > 0) {
    const blocks: ExportDocument["sections"][0]["blocks"] = [];
    for (const m of memories) {
      const sec = markdownToSection(normalizeContent(m.memory), `mem-${m.id}`, "");
      if (sec) {
        blocks.push(...sec.blocks);
        blocks.push({ type: "paragraph" as const, inline: [{ type: "text" as const, text: `Source: ${m.source}`, italic: true, code: true }] });
      }
    }
    sections.push({ key: "memory", title: "Memory items", blocks });
  }

  if (opts.sections.includes("appendix") && sources.length > 0) {
    const blocks: ExportDocument["sections"][0]["blocks"] = [];
    for (const s of sources) {
      const sec = markdownToSection(
        `**${s.title}** (${s.type})\n${s.originUrl ? `URL: ${s.originUrl}` : ""}`,
        `source-${s.id}`,
        ""
      );
      if (sec) blocks.push(...sec.blocks);
    }
    sections.push({ key: "appendix", title: "Appendix: Full source list", blocks });
  }

  if (references.length > 0) {
    const blocks: ExportDocument["sections"][0]["blocks"] = [];
    blocks.push({ type: "heading" as const, level: 2, inline: [{ type: "text" as const, text: "References" }] });
    const listItems = references.map((r) => ({
       inline: [
         { type: "footnote-ref" as const, id: r.id },
         { type: "text" as const, text: ` ${r.sourceTitle} (${r.sourceType})${r.locator ? ` — ${r.locator}` : ""}${r.originUrl ? ` — ${r.originUrl}` : ""}` },
       ],
      children: [],
    }));
    blocks.push({ type: "list" as const, ordered: true, items: listItems });
    sections.push({ key: "references", title: "References", blocks });
  }

   const mergedSections = mergeSections(sections);

  return {
    title: notebook.title,
    author,
    metadata: {
      "Export date": exportDate,
      "Notebook": notebook.title,
      "Author": author,
      "Sources": String(sourceCount),
    },
    sections: mergedSections,
    references: references.length > 0 ? references : undefined,
  };
}

function mergeSections(sections: Section[]): Section[] {
  const byKey = new Map<string, Section>();
  for (const s of sections) {
    const existing = byKey.get(s.key);
    if (existing) {
      existing.blocks.push(...s.blocks);
    } else {
      byKey.set(s.key, { key: s.key, title: s.title, blocks: [...s.blocks] });
    }
  }
  return Array.from(byKey.values());
}