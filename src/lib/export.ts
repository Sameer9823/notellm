import { formatTimestamp } from "@/lib/source-meta";
import type { Citation, MessageDTO, NoteDTO, RoadmapNodeDTO } from "@/types";

/** Triggers a browser download of `content` as a .md file. */
export function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Opens a print-styled window with the given HTML body and triggers the
 *  browser's print dialog, so the user can "Save as PDF" — avoids pulling
 *  in a client-side PDF library just for this. */
export function printAsPdf(title: string, bodyHtml: string) {
  const win = window.open("", "_blank", "width=850,height=1100");
  if (!win) return;
  win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #18181b; padding: 32px 40px; line-height: 1.55; max-width: 780px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; border-bottom: 1px solid #e4e4e7; padding-bottom: 4px; }
  .meta { color: #71717a; font-size: 12px; margin-bottom: 20px; }
  .msg { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #f1f1f3; }
  .role { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: #6d28d9; margin-bottom: 4px; }
  .role.user { color: #52525b; }
  .content { white-space: pre-wrap; font-size: 13.5px; }
  .citations { margin-top: 6px; font-size: 11px; color: #71717a; }
  .cite { display: inline-block; border: 1px solid #e4e4e7; border-radius: 6px; padding: 1px 6px; margin: 2px 4px 0 0; }
  .node { margin-bottom: 14px; padding: 10px 12px; border: 1px solid #e4e4e7; border-radius: 8px; }
  .node h3 { margin: 0 0 4px; font-size: 13.5px; }
  .node p { margin: 0 0 6px; font-size: 12.5px; color: #3f3f46; }
  .kw { display: inline-block; font-size: 10.5px; color: #52525b; border: 1px solid #e4e4e7; border-radius: 999px; padding: 1px 8px; margin: 0 4px 4px 0; }
  .note { margin-bottom: 14px; padding: 10px 12px; border: 1px solid #e4e4e7; border-radius: 8px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>${bodyHtml}</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "\""); 
}

function citationLine(c: Citation): string {
  const locator = c.page != null ? `p. ${c.page}` : c.startSec != null ? formatTimestamp(c.startSec) : null;
  return `[${c.marker}] ${c.sourceTitle}${locator ? ` (${locator})` : ""}`;
}

// ---------------------------------------------------------------- Chat ----

export function chatToMarkdown(notebookTitle: string, messages: MessageDTO[]): string {
  const lines: string[] = [`# ${notebookTitle} — Chat transcript`, "", `_Exported ${new Date().toLocaleString()}_`, ""];
  for (const m of messages) {
    lines.push(`## ${m.role === "USER" ? "You" : "Assistant"}`, "", m.content, "");
    if (m.citations?.length) {
      lines.push("**Sources:**");
      for (const c of m.citations) lines.push(`- ${citationLine(c)}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function chatToPdfHtml(notebookTitle: string, messages: MessageDTO[]): string {
  const rows = messages
    .map((m) => {
      const cites = m.citations?.length
        ? `<div class="citations">${m.citations.map((c) => `<span class="cite">${escapeHtml(citationLine(c))}</span>`).join("")}</div>`
        : "";
      return `<div class="msg"><div class="role ${m.role === "USER" ? "user" : ""}">${m.role === "USER" ? "You" : "Assistant"}</div><div class="content">${escapeHtml(m.content)}</div>${cites}</div>`;
    })
    .join("");
  return `<h1>${escapeHtml(notebookTitle)}</h1><div class="meta">Chat transcript — exported ${new Date().toLocaleString()}</div>${rows}`;
}

// --------------------------------------------------------------- Notes ----

export function notesToMarkdown(notebookTitle: string, notes: NoteDTO[]): string {
  const lines: string[] = [`# ${notebookTitle} — Notes`, "", `_Exported ${new Date().toLocaleString()}_`, ""];
  for (const n of notes) {
    lines.push(`## ${new Date(n.createdAt).toLocaleString()}`, "", n.content, "");
    if (n.citations?.length) {
      lines.push("**Sources:**");
      for (const c of n.citations) lines.push(`- ${citationLine(c)}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function notesToPdfHtml(notebookTitle: string, notes: NoteDTO[]): string {
  const rows = notes
    .map((n) => {
      const cites = n.citations?.length
        ? `<div class="citations">${n.citations.map((c) => `<span class="cite">${escapeHtml(citationLine(c))}</span>`).join("")}</div>`
        : "";
      return `<div class="note"><div class="meta">${new Date(n.createdAt).toLocaleString()}</div><div class="content">${escapeHtml(n.content)}</div>${cites}</div>`;
    })
    .join("");
  return `<h1>${escapeHtml(notebookTitle)}</h1><div class="meta">Notes — exported ${new Date().toLocaleString()}</div>${rows}`;
}

// ------------------------------------------------------------- Roadmap ----

export function roadmapToMarkdown(notebookTitle: string, nodes: RoadmapNodeDTO[]): string {
  const ordered = [...nodes].sort((a, b) => a.order - b.order);
  const lines: string[] = [`# ${notebookTitle} — Learning roadmap`, "", `_Exported ${new Date().toLocaleString()}_`, ""];
  ordered.forEach((n, i) => {
    lines.push(`## ${i + 1}. ${n.label}`, "", n.summary, "");
    if (n.keywords.length) lines.push(`**Keywords:** ${n.keywords.join(", ")}`, "");
    for (const v of n.videos) {
      lines.push(`- **${v.title}** — ${v.timestamps.map(formatTimestamp).join(", ")}`);
    }
    lines.push("");
  });
  return lines.join("\n");
}

export function roadmapToPdfHtml(notebookTitle: string, nodes: RoadmapNodeDTO[]): string {
  const ordered = [...nodes].sort((a, b) => a.order - b.order);
  const rows = ordered
    .map((n, i) => {
      const kws = n.keywords.map((k) => `<span class="kw">${escapeHtml(k)}</span>`).join("");
      const vids = n.videos
        .map((v) => `<div>• <strong>${escapeHtml(v.title)}</strong> — ${v.timestamps.map(formatTimestamp).join(", ")}</div>`)
        .join("");
      return `<div class="node"><h3>${i + 1}. ${escapeHtml(n.label)}</h3><p>${escapeHtml(n.summary)}</p>${kws}${vids}</div>`;
    })
    .join("");
  return `<h1>${escapeHtml(notebookTitle)}</h1><div class="meta">Learning roadmap — exported ${new Date().toLocaleString()}</div>${rows}`;
}