import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  SimpleField,
  LevelFormat,
  Numbering,
  PageBreak,
  ExternalHyperlink,
  ShadingType,
  AlignmentType,
  TableLayoutType,
  type ILevelsOptions,
} from "docx";
import type { ExportDocument, Block, InlineNode, HeadingBlock, ParagraphBlock, CodeBlock, ListBlock, TableBlock, ListItem } from "./types";

function renderInline(runs: InlineNode[]): (TextRun | ExternalHyperlink)[] {
  return runs.map((r) => {
    if (r.type === "text") {
      const runOptions: Record<string, unknown> = {
        text: r.text,
        bold: r.bold,
        italics: r.italic,
        strike: r.strike,
        font: "Inter",
        color: r.code ? "2D2D2D" : "000000",
        size: 22,
      };
      if (r.underline) {
        runOptions.underline = { type: "single" as const, color: "000000" };
      }
      if (r.code) {
        runOptions.shding = { fill: "F5F5F5", type: ShadingType.CLEAR };
        runOptions.style = "monospace";
      }
      return new TextRun(runOptions as Record<string, unknown>);
    }
    if (r.type === "link") {
      const children = renderInline(r.children);
      const styledChildren = children.map((c) => {
        if (c instanceof TextRun) {
          return new TextRun({ ...c, underline: { type: "single", color: "0000EE" } });
        }
        return c;
      });
      return new ExternalHyperlink({
        children: styledChildren,
        link: r.href,
      });
    }
    if (r.type === "footnote-ref") {
      return new TextRun({
        text: `[${r.id}]`,
        bold: true,
        color: "0000EE",
        font: "Inter",
        size: 20,
        superScript: true,
      });
    }
    return new TextRun({ text: "", font: "Inter", size: 22 });
  });
}

type SectionLike = { children: (Paragraph | Table | SimpleField)[] };

function renderBlock(doc: SectionLike, block: Block, opts: { inList?: boolean } = {}): void {
  switch (block.type) {
    case "heading": {
      const level = block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : block.level === 3 ? HeadingLevel.HEADING_3 : block.level === 4 ? HeadingLevel.HEADING_4 : block.level === 5 ? HeadingLevel.HEADING_5 : HeadingLevel.HEADING_6;
      doc.children.push(new Paragraph({
        heading: level,
        keepNext: true,
        keepLines: true,
        children: renderInline(block.inline),
      }));
      break;
    }
    case "paragraph": {
      const para = new Paragraph({
        children: renderInline(block.inline),
        alignment: block.align === "center" ? AlignmentType.CENTER : block.align === "right" ? AlignmentType.RIGHT : block.align === "justify" ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
        indent: block.quote ? { left: 720 } : undefined,
        spacing: { after: 120 },
      });
      doc.children.push(para);
      break;
    }
    case "code": {
      const lines = block.text.split("\n");
      for (const line of lines) {
        doc.children.push(
          new Paragraph({
            children: [new TextRun({
              text: line,
              font: "Inter",
              size: 20,
              color: "2D2D2D",
              shading: { fill: "F5F5F5", type: ShadingType.CLEAR },
            })],
            spacing: { after: 0 },
            indent: { left: 720 },
          })
        );
      }
      break;
    }
    case "list": {
      const ref = block.ordered ? "NUMBER" : "BULLET";
      for (const item of block.items) {
        const itemPara = new Paragraph({
          children: renderInline(item.inline),
          numbering: { reference: ref, level: 0 },
          spacing: { after: 60 },
        });
        doc.children.push(itemPara);
        for (const child of item.children) {
          renderBlock(doc, child, { inList: true });
        }
      }
      break;
    }
    case "table": {
      const headerRow = block.header
        ? new TableRow({
            tableHeader: true,
            children: block.header.map((cell) =>
              new TableCell({
                width: { size: 100 / block.columns, type: "pct" },
                children: [new Paragraph({ children: renderInline(cell), alignment: AlignmentType.LEFT })],
                shading: { fill: "D9D9D9", type: ShadingType.CLEAR, color: "auto" },
              })
            ),
          })
        : undefined;

      const rows = block.rows.map((row) =>
        new TableRow({
          children: row.map((cell) =>
            new TableCell({
              width: { size: 100 / block.columns, type: "pct" },
              children: [new Paragraph({ children: renderInline(cell) })],
            })
          ),
        })
      );

      doc.children.push(
        new Table({
          width: { size: 100, type: "pct" },
          rows: headerRow ? [headerRow, ...rows] : rows,
          layout: TableLayoutType.FIXED,
        })
      );
      break;
    }
  }
}

export async function renderDocx(doc: ExportDocument): Promise<Buffer> {
  const bulletLevels: ILevelsOptions[] = [
    { level: 0, format: LevelFormat.BULLET, text: "•" },
    { level: 1, format: LevelFormat.BULLET, text: "–" },
  ];
  const numberLevels: ILevelsOptions[] = [
    { level: 0, format: LevelFormat.DECIMAL, text: "%1." },
  ];

  const docx = new Document({
    numbering: {
      config: [
        { reference: "BULLET", levels: bulletLevels },
        { reference: "NUMBER", levels: numberLevels },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: "Inter", size: 22 },
          paragraph: { spacing: { line: 276 } },
        },
      },
      paragraphStyles: [
        { id: "Normal", name: "Normal", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Inter", size: 22 }, paragraph: { spacing: { line: 276, after: 120 } } },
        { id: "Heading1", name: "heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Inter", bold: true, size: 32, color: "1A8A6D" }, paragraph: { spacing: { before: 240, after: 120 } } },
        { id: "Heading2", name: "heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Inter", bold: true, size: 26, color: "1A8A6D" }, paragraph: { spacing: { before: 180, after: 100 } } },
        { id: "Heading3", name: "heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Inter", bold: true, size: 24, color: "1A8A6D" }, paragraph: { spacing: { before: 140, after: 80 } } },
      ],
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [new TextRun({ text: doc.title, font: "Inter", size: 20, color: "666666", bold: true })],
                alignment: AlignmentType.CENTER,
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
                  new TextRun({ text: "Page ", font: "Inter", size: 18, color: "999999" }),
                  new SimpleField("PAGE"),
                  new TextRun({ text: " of ", font: "Inter", size: 18, color: "999999" }),
                  new SimpleField("NUMPAGES"),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({ text: "", spacing: { before: 720 } }),
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: doc.title, font: "Inter", size: 48, bold: true, color: "1A8A6D" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
          }),
          doc.author
            ? new Paragraph({
                children: [new TextRun({ text: `Prepared for ${doc.author}`, font: "Inter", size: 24, color: "6B7280" })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 120 },
              })
            : undefined,
          new Paragraph({
            children: [new TextRun({ text: `Exported ${doc.metadata["Export date"] || new Date().toLocaleString()}`, font: "Inter", size: 20, color: "999999" })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
          }),
          new PageBreak(),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            keepNext: true,
            keepLines: true,
            children: [new TextRun({ text: "Table of Contents", font: "Inter", size: 32, bold: true })],
            spacing: { after: 240 },
          }),
          ...doc.sections.map((s) =>
            new Paragraph({
              children: [new TextRun({ text: s.title, font: "Inter", size: 22 })],
              spacing: { after: 60 },
              indent: { left: 720 },
            })
          ),
          new PageBreak(),
        ].filter(Boolean) as SectionLike["children"],
      },
      ...doc.sections.map((s) => ({
        properties: {
          page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            keepNext: true,
            keepLines: true,
            children: [new TextRun({ text: s.title, font: "Inter", size: 32, bold: true, color: "1A8A6D" })],
            spacing: { after: 240 },
          }),
          ...s.blocks.flatMap((b) => {
            const children: (Paragraph | Table)[] = [];
            const tempDoc: SectionLike = { children };
            renderBlock(tempDoc, b);
            return children;
          }),
        ],
      })),
    ].filter(Boolean) as import("docx").ISectionOptions[],
  });

  const buf = await Packer.toBuffer(docx);
  return buf;
}
