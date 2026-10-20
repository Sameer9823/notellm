import PDFDocument from "pdfkit";
import type { PDFDocument as IPDFDocument } from "pdfkit";
import { registerInterFonts, interRegular, interBold } from "./fonts";
import type { ExportDocument, Block, InlineNode, HeadingBlock, ParagraphBlock, CodeBlock, ListBlock, TableBlock, ListItem } from "./types";

const MARGIN = 72;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const HEADING_SIZES = { 1: 20, 2: 17, 3: 15, 4: 13, 5: 12, 6: 11 };
const ACCENT_COLOR = "#1A8A6D";
const TEXT_COLOR = "#18181B";
const META_COLOR = "#71717a";

function ensureSpace(doc: IPDFDocument, needed: number): void {
  const remaining = PAGE_HEIGHT - MARGIN - doc.y;
  if (remaining < needed) {
    doc.addPage();
    doc.font("Inter").fontSize(FONT_SIZE).fillColor(TEXT_COLOR);
  }
}

function writeInline(doc: IPDFDocument, runs: InlineNode[], opts: { x?: number; y?: number; maxWidth?: number; continued?: boolean } = {}) {
  const x = opts.x ?? doc.x;
  const y = opts.y ?? doc.y;
  const maxWidth = opts.maxWidth ?? CONTENT_WIDTH;
  let currentX = x;
  let currentY = y;

  for (const r of runs) {
    if (r.type === "text") {
      const font = r.bold ? "Inter-Bold" : r.italic ? "Inter" : "Inter";
      const style = r.code ? "monospace" : undefined;
      doc.font(font).fontSize(FONT_SIZE);
      if (r.code) doc.font("Inter").fontSize(FONT_SIZE);
      doc.fillColor(r.code ? "#2D2D2D" : "#000000");
      if (r.bold && !r.code) doc.font("Inter-Bold");
      else if (r.italic && !r.code) doc.font("Inter");
      else if (r.code) doc.font("Inter");
      else doc.font("Inter");

      const text = r.text;
      const w = doc.widthOfString(text, { font: r.bold ? "Inter-Bold" : "Inter", fontSize: FONT_SIZE, features: r.code ? ["mono"] : undefined });
      if (currentX + w > x + maxWidth && currentX > x) {
        currentX = x;
        currentY += LINE_HEIGHT;
        doc.x = currentX;
        doc.y = currentY;
      }
      doc.text(text, currentX, currentY, { width: maxWidth - (currentX - x), continued: true });
      currentX = doc.x;
      currentY = doc.y;
    } else if (r.type === "link") {
      doc.font("Inter").fontSize(FONT_SIZE).fillColor("#0000EE");
      const text = r.children.map((c) => (c.type === "text" ? c.text : "")).join("");
      const w = doc.widthOfString(text, { fontSize: FONT_SIZE });
      if (currentX + w > x + maxWidth && currentX > x) {
        currentX = x;
        currentY += LINE_HEIGHT;
      }
      doc.link(currentX, currentY, w, LINE_HEIGHT, r.href);
      doc.text(text, currentX, currentY, { width: maxWidth - (currentX - x), continued: true, underline: true });
      currentX = doc.x;
      currentY = doc.y;
    } else if (r.type === "footnote-ref") {
      doc.font("Inter").fontSize(FONT_SIZE - 2).fillColor("#0000EE");
      const text = `[${r.id}]`;
      const w = doc.widthOfString(text, { fontSize: FONT_SIZE - 2 });
      if (currentX + w > x + maxWidth && currentX > x) {
        currentX = x;
        currentY += LINE_HEIGHT;
      }
      doc.text(text, currentX, currentY, { continued: true });
      currentX = doc.x;
      currentY = doc.y;
    }
  }
  doc.x = currentX;
  doc.y = currentY;
}

function renderBlock(doc: IPDFDocument, block: Block): void {
  switch (block.type) {
    case "heading": {
      const size = HEADING_SIZES[block.level as keyof typeof HEADING_SIZES] ?? FONT_SIZE;
      ensureSpace(doc, size + LINE_HEIGHT + 12);
      doc.font("Inter-Bold").fontSize(size).fillColor(ACCENT_COLOR);
      const text = block.inline.map((r) => (r.type === "text" ? r.text : "")).join("");
      doc.moveDown(0.6);
      doc.text(text, { width: CONTENT_WIDTH });
      doc.moveDown(0.35);
      break;
    }
    case "paragraph": {
      doc.font("Inter").fontSize(FONT_SIZE).fillColor(TEXT_COLOR);
      if (block.quote) {
        const savedX = doc.x;
        doc.x += 36;
        doc.moveDown(0.2);
        writeInline(doc, block.inline, { x: doc.x, maxWidth: CONTENT_WIDTH - 36 });
        doc.x = savedX;
        doc.moveDown(0.5);
      } else {
        writeInline(doc, block.inline);
        doc.moveDown(0.5);
      }
      break;
    }
    case "code": {
      doc.font("Inter").fontSize(FONT_SIZE - 1).fillColor("#2D2D2D");
      const savedX = doc.x;
      doc.x += 36;
      const lines = block.text.split("\n");
      for (const line of lines) {
        doc.text(line, { width: CONTENT_WIDTH - 36 });
      }
      doc.x = savedX;
      doc.moveDown(0.5);
      break;
    }
    case "list": {
      for (const item of block.items) {
        const marker = block.ordered ? `${block.start ?? 1}. ` : "• ";
        doc.font("Inter-Bold").fontSize(FONT_SIZE).fillColor("#000000");
        doc.text(marker, { continued: true, width: CONTENT_WIDTH });
        writeInline(doc, item.inline, { maxWidth: CONTENT_WIDTH - doc.widthOfString(marker) });
        doc.moveDown(0.4);
        for (const child of item.children) {
          renderBlock(doc, child);
        }
        if (block.ordered && block.start != null) block.start++;
      }
      doc.moveDown(0.3);
      break;
    }
    case "table": {
      if (!block.header || !block.rows.length) break;
      const colCount = block.columns;
      const colWidth = CONTENT_WIDTH / colCount;
      const headerHeight = 24;

      const drawHeader = () => {
        doc.font("Inter-Bold").fontSize(FONT_SIZE - 1).fillColor("#FFFFFF");
        for (let i = 0; i < colCount; i++) {
          const x = MARGIN + i * colWidth;
          doc.rect(x, doc.y, colWidth, headerHeight).fill("#1A1A1A");
          const cellText = block.header![i].map((r) => (r.type === "text" ? r.text : "")).join("");
          doc.fillColor("#FFFFFF").font("Inter-Bold").fontSize(FONT_SIZE - 1);
          doc.text(cellText, x + 4, doc.y + 4, { width: colWidth - 8 });
        }
        doc.y += headerHeight;
      };

      const drawRow = (row: InlineNode[][]) => {
        doc.font("Inter").fontSize(FONT_SIZE - 1).fillColor("#000000");
        const rowHeight = 20;
        for (let i = 0; i < colCount; i++) {
          const x = MARGIN + i * colWidth;
          doc.rect(x, doc.y, colWidth, rowHeight).stroke("#CCCCCC");
          const cellText = row[i].map((r) => (r.type === "text" ? r.text : "")).join("");
          doc.text(cellText, x + 4, doc.y + 3, { width: colWidth - 8 });
        }
        doc.y += rowHeight;
      };

      drawHeader();
      for (const row of block.rows) {
        if (doc.y > PAGE_HEIGHT - MARGIN - 30) {
          doc.addPage();
          drawHeader();
        }
        drawRow(row);
      }
      doc.moveDown(0.5);
      break;
    }
  }
}

export async function renderPdf(doc: ExportDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf: IPDFDocument = new PDFDocument({
      size: "LETTER",
      margin: MARGIN,
      bufferPages: true,
      info: {
        Title: doc.title,
        Author: doc.author || "Footnote",
        Subject: "Study Material Export",
        Keywords: "notebook, study, export",
      },
    });

    const chunks: Buffer[] = [];
    pdf.on("data", (c) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    registerInterFonts(pdf as any);
    pdf.font("Inter").fontSize(FONT_SIZE).fillColor(TEXT_COLOR);

    const drawDecorations = (pageNum: number, total: number): void => {
      pdf.switchToPage(pageNum - 1);
      pdf.font("Inter").fontSize(9).fillColor(META_COLOR);
      pdf.text(doc.title, MARGIN, 22, { align: "center", width: CONTENT_WIDTH });
      pdf.text(`Page ${pageNum} of ${total}`, MARGIN, PAGE_HEIGHT - MARGIN - 14, { align: "center", width: CONTENT_WIDTH });
      pdf.switchToPage(total - 1);
    };

    // ---- Cover ----
    pdf.moveDown(3);
    pdf.font("Inter-Bold").fontSize(26).fillColor(ACCENT_COLOR);
    pdf.text(doc.title, { align: "center", width: CONTENT_WIDTH });
    pdf.moveDown(0.7);
    if (doc.author) {
      pdf.font("Inter").fontSize(13).fillColor("#4B5563");
      pdf.text(`Prepared for ${doc.author}`, { align: "center", width: CONTENT_WIDTH });
      pdf.moveDown(0.4);
    }
    pdf.font("Inter").fontSize(11).fillColor(META_COLOR);
    pdf.text(`Exported ${doc.metadata["Export date"] || new Date().toLocaleString()}`, { align: "center", width: CONTENT_WIDTH });
    pdf.moveDown(1.8);

    // ---- Contents ----
    pdf.font("Inter-Bold").fontSize(16).fillColor(TEXT_COLOR);
    pdf.text("Table of Contents", { align: "center", width: CONTENT_WIDTH });
    pdf.moveDown(0.8);
    for (const s of doc.sections) {
      pdf.font("Inter").fontSize(11).fillColor("#333333");
      pdf.text(s.title, { indent: 24, width: CONTENT_WIDTH - 24 });
    }
    pdf.addPage();

    // ---- Sections ----
    for (const s of doc.sections) {
      ensureSpace(pdf, 80);
      pdf.font("Inter-Bold").fontSize(20).fillColor(ACCENT_COLOR);
      pdf.text(s.title, { width: CONTENT_WIDTH });
      pdf.moveDown(0.5);
      for (const b of s.blocks) {
        renderBlock(pdf, b);
      }
      pdf.moveDown(1.2);
    }

    // ---- References ----
    if (doc.references && doc.references.length > 0) {
      ensureSpace(pdf, 80);
      pdf.font("Inter-Bold").fontSize(16).fillColor(ACCENT_COLOR);
      pdf.text("References", { width: CONTENT_WIDTH });
      pdf.moveDown(0.5);
      for (const r of doc.references) {
        ensureSpace(pdf, 24);
        pdf.font("Inter-Bold").fontSize(11).fillColor("#0000EE");
        const refText = `[${r.id}] ${r.sourceTitle} (${r.sourceType})${r.locator ? ` — ${r.locator}` : ""}${r.originUrl ? ` — ${r.originUrl}` : ""}`;
        pdf.text(refText, { width: CONTENT_WIDTH, indent: 24 });
      }
    }

    const range = pdf.bufferedPageRange();
    const total = range.start + range.count;
    for (let i = 1; i <= total; i++) {
      drawDecorations(i, total);
    }

    pdf.end();
  });
}