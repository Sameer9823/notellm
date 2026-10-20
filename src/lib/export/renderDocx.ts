import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  BorderStyle,
  type IRunOptions,
  type ISectionOptions,
  type ParagraphChild,
} from "docx";
import type { Block, ExportDocument, InlineNode } from "./types";

// US Letter, 1" margins -> 9360 twips of usable width.
const CONTENT_WIDTH = 9360;
const FONT = "Calibri";
const MONO = "Consolas";
const ACCENT = "1A8A6D";

// Characters that are illegal in XML 1.0 and make Word report "unreadable content".
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const clean = (s: string) => (s ?? "").replace(ILLEGAL_XML, "");

type RunStyle = {
  -readonly [K in "bold" | "italics" | "strike" | "underline" | "color" | "size" | "font" | "shading"]?: IRunOptions[K];
};

function textRuns(text: string, style: RunStyle): TextRun[] {
  const lines = clean(text).split(/\r?\n/);
  return lines.map(
    (line, i) =>
      new TextRun({
        text: line,
        break: i > 0 ? 1 : undefined,
        font: FONT,
        size: 22,
        ...style,
      })
  );
}

function renderInline(nodes: InlineNode[], inherited: RunStyle = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case "text": {
        const style: RunStyle = {
          ...inherited,
          bold: n.bold || inherited.bold,
          italics: n.italic || inherited.italics,
          strike: n.strike || inherited.strike,
        };
        if (n.underline) style.underline = { type: "single" };
        if (n.code) {
          style.font = MONO;
          style.size = 20;
          style.color = "2D2D2D";
          style.shading = { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" };
        }
        out.push(...textRuns(n.text, style));
        break;
      }
      case "link": {
        const href = clean(n.href);
        const kids = renderInline(n.children, { ...inherited, color: "0563C1", underline: { type: "single" } });
        if (/^(https?:|mailto:)/i.test(href)) {
          out.push(new ExternalHyperlink({ link: href, children: kids as TextRun[] }));
        } else {
          out.push(...kids);
        }
        break;
      }
      case "image":
        out.push(...textRuns(n.alt ? `[Image: ${n.alt}]` : "[Image]", { ...inherited, italics: true, color: "6B7280" }));
        break;
      case "footnote-ref":
        out.push(new TextRun({ text: `[${n.id}]`, bold: true, color: "0563C1", font: FONT, size: 18, superScript: true }));
        break;
    }
  }
  return out;
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

type BlockOut = Paragraph | Table;

function renderBlock(block: Block, ctx: { listCounter: { n: number }; level: number }): BlockOut[] {
  switch (block.type) {
    case "heading":
      return [
        new Paragraph({
          heading: HEADINGS[Math.min(Math.max(block.level, 1), 6) - 1],
          keepNext: true,
          keepLines: true,
          children: renderInline(block.inline),
        }),
      ];

    case "paragraph":
      return [
        new Paragraph({
          children: renderInline(block.inline, block.quote ? { italics: true, color: "4B5563" } : {}),
          alignment: block.align ? ALIGN[block.align] : AlignmentType.LEFT,
          indent: block.quote ? { left: 720 } : undefined,
          border: block.quote ? { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 } } : undefined,
          spacing: { after: 120 },
        }),
      ];

    case "code":
      return clean(block.text)
        .split(/\r?\n/)
        .map(
          (line) =>
            new Paragraph({
              children: [
                new TextRun({
                  text: line === "" ? " " : line,
                  font: MONO,
                  size: 19,
                  color: "2D2D2D",
                }),
              ],
              shading: { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" },
              indent: { left: 360 },
              spacing: { after: 0 },
            })
        )
        .concat([new Paragraph({ children: [], spacing: { after: 80 } })]);

    case "list": {
      ctxCounter.n += 1;
      const instance = ctxCounter.n;
      const level = Math.min(ctx.level, 3);
      const out: BlockOut[] = [];
      for (const item of block.items) {
        out.push(
          new Paragraph({
            children: renderInline(item.inline),
            numbering: { reference: block.ordered ? "NUMBERED" : "BULLETS", level, instance: block.ordered ? instance : undefined },
            spacing: { after: 60 },
          })
        );
        for (const child of item.children ?? []) {
          out.push(...renderBlock(child, { listCounter: ctx.listCounter, level: child.type === "list" ? level + 1 : level }));
        }
      }
      return out;
    }

    case "table": {
      const cols = Math.max(block.columns || block.header?.length || block.rows[0]?.length || 1, 1);
      const base = Math.floor(CONTENT_WIDTH / cols);
      const widths = Array.from({ length: cols }, (_, i) => (i === cols - 1 ? CONTENT_WIDTH - base * (cols - 1) : base));
      const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
      const borders = { top: border, bottom: border, left: border, right: border };

      const makeRow = (cells: InlineNode[][], header: boolean) => {
        const padded = Array.from({ length: cols }, (_, i) => cells[i] ?? []);
        return new TableRow({
          tableHeader: header,
          cantSplit: true,
          children: padded.map(
            (cell, i) =>
              new TableCell({
                width: { size: widths[i], type: WidthType.DXA },
                borders,
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                shading: header ? { type: ShadingType.CLEAR, fill: "E3F4EE", color: "auto" } : undefined,
                children: [
                  new Paragraph({
                    children: renderInline(cell, header ? { bold: true } : {}),
                    alignment: block.aligns?.[i] ? ALIGN[block.aligns[i]!] : AlignmentType.LEFT,
                  }),
                ],
              })
          ),
        });
      };

      const rows = [...(block.header ? [makeRow(block.header, true)] : []), ...block.rows.map((r) => makeRow(r, false))];
      if (rows.length === 0) return [];
      return [
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: widths,
          layout: TableLayoutType.FIXED,
          rows,
        }),
        new Paragraph({ children: [], spacing: { after: 120 } }),
      ];
    }
  }
}

// Module-level counter so every ordered list restarts at 1.
const ctxCounter = { n: 0 };

const pageBreak = () => new Paragraph({ children: [new TextRun({ break: 1 })], pageBreakBefore: true, spacing: { after: 0 } });

function headerFooter(title: string) {
  return {
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: clean(title), font: FONT, size: 18, color: "6B7280", bold: true })],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Page ", font: FONT, size: 18, color: "6B7280" }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: "6B7280" }),
              new TextRun({ text: " of ", font: FONT, size: 18, color: "6B7280" }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 18, color: "6B7280" }),
            ],
          }),
        ],
      }),
    },
  };
}

const PAGE = { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } };

export async function renderDocx(doc: ExportDocument): Promise<Buffer> {
  ctxCounter.n = 0;
  const title = clean(doc.title || "Notebook export");
  const hf = headerFooter(title);

  const metaEntries = Object.entries(doc.metadata ?? {});

  const cover: (Paragraph | Table)[] = [
    new Paragraph({ children: [], spacing: { before: 2400 } }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: title, font: FONT, size: 56, bold: true, color: ACCENT })],
    }),
    ...(doc.author
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [new TextRun({ text: `Prepared for ${clean(doc.author)}`, font: FONT, size: 26, color: "6B7280" })],
          }),
        ]
      : []),
    ...metaEntries.map(
      ([k, v]) =>
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [
            new TextRun({ text: `${clean(k)}: `, font: FONT, size: 20, color: "9CA3AF", bold: true }),
            new TextRun({ text: clean(String(v)), font: FONT, size: 20, color: "6B7280" }),
          ],
        })
    ),
    pageBreak(),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      children: [new TextRun({ text: "Contents", font: FONT, size: 34, bold: true, color: ACCENT })],
    }),
    ...doc.sections.map(
      (s, i) =>
        new Paragraph({
          spacing: { after: 80 },
          indent: { left: 360 },
          children: [new TextRun({ text: `${i + 1}.  ${clean(s.title)}`, font: FONT, size: 24 })],
        })
    ),
  ];

  const sections: ISectionOptions[] = [
    { properties: { page: PAGE }, ...hf, children: cover },
    ...doc.sections.map((s): ISectionOptions => {
      const body = s.blocks.flatMap((b) => renderBlock(b, { listCounter: ctxCounter, level: 0 }));
      return {
        properties: { page: PAGE },
        ...hf,
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            keepNext: true,
            keepLines: true,
            spacing: { after: 200 },
            children: [new TextRun({ text: clean(s.title), font: FONT, size: 34, bold: true, color: ACCENT })],
          }),
          ...(body.length ? body : [new Paragraph({ children: [new TextRun({ text: "No content.", font: FONT, size: 22, italics: true, color: "9CA3AF" })] })]),
        ],
      };
    }),
  ];

  const bulletLevels = ["\u2022", "\u25E6", "\u25AA", "\u2013"].map((text, level) => ({
    level,
    format: LevelFormat.BULLET,
    text,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
  }));
  const numberLevels = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL].map((format, level) => ({
    level,
    format,
    text: `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
  }));

  const docx = new Document({
    creator: clean(doc.author ?? "NoteLLM"),
    title,
    numbering: {
      config: [
        { reference: "BULLETS", levels: bulletLevels },
        { reference: "NUMBERED", levels: numberLevels },
      ],
    },
    styles: {
      default: { document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { line: 276 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, bold: true, size: 34, color: ACCENT }, paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, bold: true, size: 28, color: ACCENT }, paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, bold: true, size: 25, color: "2D2D2D" }, paragraph: { spacing: { before: 160, after: 100 }, outlineLevel: 2 } },
        { id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, bold: true, size: 23, color: "2D2D2D" }, paragraph: { spacing: { before: 120, after: 80 }, outlineLevel: 3 } },
      ],
    },
    sections,
  });

  return Packer.toBuffer(docx);
}