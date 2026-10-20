import PDFDocument from "pdfkit";
import { registerInterFonts } from "./fonts";
import type { ExportDocument, Block, InlineNode, ListBlock, TableBlock } from "./types";

// ---- Minimal local typings: independent of whichever pdfkit typings the project has ----
interface TextOpts {
  width?: number; continued?: boolean; lineGap?: number; align?: "left" | "center" | "right" | "justify";
  underline?: boolean; link?: string; lineBreak?: boolean; characterSpacing?: number;
}
interface Pdf {
  x: number; y: number;
  page: { margins: { top: number; bottom: number; left: number; right: number } };
  font(name: string): Pdf; fontSize(n: number): Pdf; fillColor(c: string): Pdf; strokeColor(c: string): Pdf;
  text(t: string, x?: number | TextOpts, y?: number | TextOpts, o?: TextOpts): Pdf;
  heightOfString(t: string, o?: TextOpts): number;
  rect(x: number, y: number, w: number, h: number): Pdf; fill(c?: string): Pdf;
  moveTo(x: number, y: number): Pdf; lineTo(x: number, y: number): Pdf; lineWidth(n: number): Pdf; stroke(): Pdf;
  registerFont(name: string, src: string | Buffer): Pdf;
  addPage(): Pdf; switchToPage(n: number): Pdf; bufferedPageRange(): { start: number; count: number };
  on(event: string, cb: (arg: never) => void): Pdf; end(): void;
}
type PdfConstructor = new (options: object) => Pdf;

// ---------------------------------------------------------------- layout ----
const MARGIN = 64;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const BOTTOM = PAGE_HEIGHT - MARGIN - 8; // lowest y content may reach
const FONT_SIZE = 10.5;
const LINE_GAP = 3;
const ACCENT = "#1A8A6D";
const ACCENT_SOFT = "#EAF5F1";
const TEXT = "#18181B";
const MUTED = "#71717A";
const RULE = "#E4E4E7";
const LINK = "#1D4ED8";
const HEADING_SIZE: Record<number, number> = { 1: 17, 2: 14.5, 3: 12.5, 4: 11.5, 5: 10.5, 6: 10.5 };

let MONO = "Inter"; // set per render: "Courier" only when using built-in fonts

type Run = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string; ref?: boolean };

// ---------------------------------------------------------------- helpers ----
function flatten(nodes: InlineNode[] | undefined, inherit: Partial<Run> = {}): Run[] {
  const out: Run[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "text") {
      if (n.text) out.push({ ...inherit, text: n.text, bold: n.bold || inherit.bold, italic: n.italic || inherit.italic, code: n.code || inherit.code });
    } else if (n.type === "link") {
      out.push(...flatten(n.children, { ...inherit, href: n.href }));
    } else if (n.type === "footnote-ref") {
      out.push({ ...inherit, text: `[${n.id}]`, ref: true });
    }
  }
  return out;
}
const plain = (nodes: InlineNode[] | undefined) => flatten(nodes).map((r) => r.text).join("");

function hasFont(doc: Pdf, name: string): boolean {
  return Boolean((doc as unknown as { _registeredFonts?: Record<string, unknown> })._registeredFonts?.[name]);
}
function styleRun(doc: Pdf, r: Run, size: number, color: string, forceBold = false) {
  let font = "Inter";
  if (r.code) font = MONO;
  else if (r.bold || forceBold) font = "Inter-Bold";
  else if (r.italic && hasFont(doc, "Inter-Italic")) font = "Inter-Italic";
  doc.font(font).fontSize(r.code ? size - 1 : r.ref ? size - 2 : size).fillColor(r.href ? LINK : r.ref ? LINK : r.code ? "#9F1239" : color);
}

function ensureSpace(doc: Pdf, needed: number) {
  if (doc.y + needed > BOTTOM) doc.addPage();
}

/** Writes runs as ONE wrapped paragraph using pdfkit's own line wrapping. */
function writeRuns(doc: Pdf, nodes: InlineNode[] | undefined, o: { x: number; width: number; size?: number; color?: string; bold?: boolean; align?: "left" | "center" }) {
  const runs = flatten(nodes);
  const size = o.size ?? FONT_SIZE;
  const color = o.color ?? TEXT;
  if (!runs.length) return;
  const startY = doc.y;
  runs.forEach((r, i) => {
    styleRun(doc, r, size, color, o.bold);
    const last = i === runs.length - 1;
    const opts = { width: o.width, continued: !last, lineGap: LINE_GAP, align: o.align ?? "left", underline: Boolean(r.href), link: r.href } satisfies TextOpts;
    if (i === 0) doc.text(r.text, o.x, startY, opts);
    else doc.text(r.text, opts);
  });
  doc.x = o.x;
}

// ----------------------------------------------------------------- blocks ----
function renderList(doc: Pdf, block: ListBlock, level: number) {
  const indent = level * 18;
  const x = MARGIN + indent;
  const markerW = block.ordered ? 22 : 14;
  let n = block.start ?? 1;
  for (const item of block.items) {
    ensureSpace(doc, 34);
    const y = doc.y;
    doc.font(block.ordered ? "Inter-Bold" : "Inter-Bold").fontSize(FONT_SIZE).fillColor(ACCENT);
    doc.text(block.ordered ? `${n}.` : level === 0 ? "•" : "–", x, y, { width: markerW, lineBreak: false });
    doc.y = y;
    writeRuns(doc, item.inline, { x: x + markerW, width: CONTENT_WIDTH - indent - markerW });
    doc.y += 3;
    for (const child of item.children) {
      if (child.type === "list") renderList(doc, child, level + 1);
      else renderBlock(doc, child);
    }
    n++;
  }
  doc.x = MARGIN;
  doc.y += level === 0 ? 5 : 0;
}

function renderTable(doc: Pdf, t: TableBlock) {
  const cols = t.columns || t.header?.length || t.rows[0]?.length || 1;
  const PAD = 6;
  // proportional column widths based on content length (min 12%)
  const sample = [t.header ?? [], ...t.rows.slice(0, 20)];
  const weights = Array.from({ length: cols }, (_, c) => Math.max(10, Math.min(45, Math.max(...sample.map((r) => plain(r[c]).length)))));
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.max(CONTENT_WIDTH * 0.12, (w / total) * CONTENT_WIDTH));
  const scale = CONTENT_WIDTH / widths.reduce((a, b) => a + b, 0);
  const W = widths.map((w) => w * scale);

  const rowHeight = (cells: InlineNode[][], bold: boolean) => {
    doc.font(bold ? "Inter-Bold" : "Inter").fontSize(FONT_SIZE - 0.5);
    return Math.max(...W.map((w, i) => doc.heightOfString(plain(cells[i]), { width: w - 2 * PAD, lineGap: 2 }))) + 2 * PAD;
  };
  const drawRow = (cells: InlineNode[][], opts: { header?: boolean; zebra?: boolean }) => {
    const h = rowHeight(cells, Boolean(opts.header));
    if (doc.y + h > BOTTOM) { doc.addPage(); if (!opts.header && t.header) drawRow(t.header, { header: true }); }
    const y = doc.y;
    let x = MARGIN;
    W.forEach((w, i) => {
      if (opts.header) doc.rect(x, y, w, h).fill(ACCENT);
      else if (opts.zebra) doc.rect(x, y, w, h).fill("#F7F8F8");
      doc.font(opts.header ? "Inter-Bold" : "Inter").fontSize(FONT_SIZE - 0.5).fillColor(opts.header ? "#FFFFFF" : TEXT);
      doc.text(plain(cells[i]), x + PAD, y + PAD, { width: w - 2 * PAD, lineGap: 2 });
      x += w;
    });
    doc.moveTo(MARGIN, y + h).lineTo(MARGIN + CONTENT_WIDTH, y + h).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.x = MARGIN; doc.y = y + h;
  };
  ensureSpace(doc, 60);
  if (t.header) drawRow(t.header, { header: true });
  t.rows.forEach((r, i) => drawRow(r, { zebra: i % 2 === 1 }));
  doc.y += 10;
}

function renderBlock(doc: Pdf, block: Block) {
  doc.x = MARGIN;
  switch (block.type) {
    case "heading": {
      const size = HEADING_SIZE[block.level] ?? FONT_SIZE;
      ensureSpace(doc, size + 70); // keep heading with the text that follows
      doc.y += block.level <= 2 ? 10 : 6;
      writeRuns(doc, block.inline, { x: MARGIN, width: CONTENT_WIDTH, size, bold: true, color: block.level <= 2 ? ACCENT : TEXT });
      if (block.level === 1) { doc.y += 2; doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_WIDTH, doc.y).lineWidth(0.6).strokeColor(RULE).stroke(); }
      doc.y += 5;
      break;
    }
    case "paragraph": {
      if (block.quote) {
        const w = CONTENT_WIDTH - 26;
        doc.font("Inter").fontSize(FONT_SIZE);
        const h = doc.heightOfString(plain(block.inline), { width: w, lineGap: LINE_GAP }) + 16;
        ensureSpace(doc, Math.min(h, 160));
        const y = doc.y;
        doc.rect(MARGIN, y, CONTENT_WIDTH, h).fill(ACCENT_SOFT);
        doc.rect(MARGIN, y, 3, h).fill(ACCENT);
        doc.y = y + 8;
        writeRuns(doc, block.inline, { x: MARGIN + 16, width: w });
        doc.y = y + h + 8;
      } else {
        ensureSpace(doc, 30);
        writeRuns(doc, block.inline, { x: MARGIN, width: CONTENT_WIDTH });
        doc.y += 6;
      }
      break;
    }
    case "code": {
      const w = CONTENT_WIDTH - 20;
      doc.font(MONO).fontSize(9);
      const h = doc.heightOfString(block.text, { width: w }) + 16;
      ensureSpace(doc, Math.min(h, 240));
      const y = doc.y;
      doc.rect(MARGIN, y, CONTENT_WIDTH, Math.min(h, BOTTOM - y)).fill("#F4F4F5");
      doc.font(MONO).fontSize(9).fillColor("#27272A").text(block.text, MARGIN + 10, y + 8, { width: w });
      doc.x = MARGIN; doc.y += 12;
      break;
    }
    case "list": renderList(doc, block, 0); break;
    case "table": renderTable(doc, block); break;
  }
  doc.x = MARGIN;
}

// ------------------------------------------------------------------- main ----
function renderOnce(doc: ExportDocument, useBuiltInFonts: boolean): Promise<Buffer> {
  MONO = useBuiltInFonts ? "Courier" : "Inter";
  return new Promise((resolve, reject) => {
    const pdf = new (PDFDocument as unknown as PdfConstructor)({
      size: "LETTER",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: doc.title, Author: doc.author || "Footnote", Subject: "Study Material Export", Keywords: "notebook, study, export" },
    });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    if (useBuiltInFonts) {
      pdf.registerFont("Inter", "Helvetica");
      pdf.registerFont("Inter-Bold", "Helvetica-Bold");
      pdf.registerFont("Inter-Italic", "Helvetica-Oblique");
    } else {
      registerInterFonts(pdf as never);
    }

    // ---- Cover band ----
    pdf.rect(0, 0, PAGE_WIDTH, 210).fill(ACCENT);
    pdf.font("Inter-Bold").fontSize(9).fillColor("#D1FAE5").text("STUDY EXPORT", MARGIN, 62, { characterSpacing: 2, width: CONTENT_WIDTH });
    pdf.font("Inter-Bold").fontSize(30).fillColor("#FFFFFF").text(doc.title, MARGIN, 82, { width: CONTENT_WIDTH, lineGap: 4 });
    let y = pdf.y + 8;
    pdf.font("Inter").fontSize(12.5).fillColor("#ECFDF5");
    if (doc.author) { pdf.text(`Prepared for ${doc.author}`, MARGIN, y, { width: CONTENT_WIDTH }); y = pdf.y + 2; }
    pdf.font("Inter").fontSize(10.5).fillColor("#D1FAE5").text(`Exported ${doc.metadata["Export date"] || new Date().toLocaleString()}`, MARGIN, y, { width: CONTENT_WIDTH });

    // ---- Contents (page numbers filled in at the end) ----
    pdf.x = MARGIN; pdf.y = 250;
    pdf.font("Inter-Bold").fontSize(15).fillColor(TEXT).text("Contents", MARGIN, 250, { width: CONTENT_WIDTH });
    pdf.moveTo(MARGIN, pdf.y + 4).lineTo(MARGIN + CONTENT_WIDTH, pdf.y + 4).lineWidth(1.2).strokeColor(ACCENT).stroke();
    pdf.y += 14;
    const toc: { page: number; y: number }[] = [];
    doc.sections.forEach((s, i) => {
      if (pdf.y > BOTTOM - 20) pdf.addPage();
      toc.push({ page: pdf.bufferedPageRange().count - 1, y: pdf.y });
      pdf.font("Inter").fontSize(11).fillColor(TEXT).text(`${i + 1}.  ${s.title}`, MARGIN, pdf.y, { width: CONTENT_WIDTH - 40, lineBreak: false });
      pdf.y = toc[i].y + 22;
    });
    if (doc.references?.length) { /* references are listed last; no TOC entry needed */ }

    // ---- Sections ----
    const startPage: number[] = [];
    doc.sections.forEach((s, i) => {
      if (i === 0) pdf.addPage(); else ensureSpace(pdf, 150);
      pdf.x = MARGIN;
      if (i > 0) pdf.y += 14;
      startPage.push(pdf.bufferedPageRange().count);
      pdf.font("Inter-Bold").fontSize(21).fillColor(TEXT).text(`${i + 1}. ${s.title}`, MARGIN, pdf.y, { width: CONTENT_WIDTH });
      pdf.moveTo(MARGIN, pdf.y + 4).lineTo(MARGIN + CONTENT_WIDTH, pdf.y + 4).lineWidth(1.4).strokeColor(ACCENT).stroke();
      pdf.y += 14;
      for (const b of s.blocks) renderBlock(pdf, b);
    });

    // ---- References ----
    if (doc.references?.length) {
      ensureSpace(pdf, 120);
      pdf.x = MARGIN; pdf.y += 14;
      pdf.font("Inter-Bold").fontSize(15).fillColor(ACCENT).text("References", MARGIN, pdf.y, { width: CONTENT_WIDTH });
      pdf.y += 8;
      for (const r of doc.references) {
        ensureSpace(pdf, 30);
        const line = `[${r.id}]  ${r.sourceTitle} (${r.sourceType})${r.locator ? `, ${r.locator}` : ""}`;
        pdf.font("Inter-Bold").fontSize(9.5).fillColor(TEXT).text(line, MARGIN, pdf.y, { width: CONTENT_WIDTH, lineGap: 2 });
        if (r.originUrl) pdf.font("Inter").fontSize(8.5).fillColor(LINK).text(r.originUrl, MARGIN + 18, pdf.y, { width: CONTENT_WIDTH - 18, link: r.originUrl, underline: true });
        pdf.y += 6;
      }
    }

    // ---- Back-fill TOC page numbers, then headers & footers ----
    toc.forEach((t, i) => {
      pdf.switchToPage(t.page);
      pdf.font("Inter").fontSize(11).fillColor(MUTED).text(String(startPage[i] ?? ""), MARGIN, t.y, { width: CONTENT_WIDTH, align: "right", lineBreak: false });
      pdf.moveTo(MARGIN, t.y + 16).lineTo(MARGIN + CONTENT_WIDTH, t.y + 16).lineWidth(0.4).strokeColor(RULE).stroke();
    });
    const range = pdf.bufferedPageRange();
    const total = range.count;
    for (let i = 0; i < total; i++) {
      pdf.switchToPage(range.start + i);
      const saved = pdf.page.margins.bottom;
      pdf.page.margins.bottom = 0; // allow drawing inside the bottom margin without spawning pages
      pdf.moveTo(MARGIN, PAGE_HEIGHT - 44).lineTo(PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 44).lineWidth(0.5).strokeColor(RULE).stroke();
      pdf.font("Inter").fontSize(8.5).fillColor(MUTED);
      pdf.text(doc.author ? `Prepared for ${doc.author}  ·  ${doc.title}` : doc.title, MARGIN, PAGE_HEIGHT - 34, { width: CONTENT_WIDTH / 1.5, lineBreak: false });
      pdf.text(`Page ${i + 1} of ${total}`, MARGIN, PAGE_HEIGHT - 34, { width: CONTENT_WIDTH, align: "right", lineBreak: false });
      pdf.page.margins.bottom = saved;
    }
    pdf.end();
  });
}

/** Renders with the Inter fonts; if anything in font loading/embedding fails,
 *  logs it and retries with built-in fonts so the user still gets a PDF. */
export async function renderPdf(doc: ExportDocument): Promise<Buffer> {
  try {
    return await renderOnce(doc, false);
  } catch (err) {
    console.error("[export] Inter fonts failed, retrying with built-in fonts:", err);
    return renderOnce(doc, true);
  }
}