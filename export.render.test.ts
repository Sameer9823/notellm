import { renderPdf } from "./src/lib/export/renderPdf";
import { renderDocx } from "./src/lib/export/renderDocx";
import { markdownToSection, normalizeContent } from "./src/lib/export/markdown";
import type { ExportDocument, InlineNode, Block } from "./src/lib/export/types";

const llmdoc = [
  "## Key takeaways",
  "Architecture matters. Maintainability is key.",
  "Key takeaways• Separation of concerns keeps modules independent",
  "• Dependency injection enables testing. 2. Layered design isolates concerns",
  "1.Avoid circular dependencies. 2.Keep data near the edge.",
  "Native lists render too:",
  "- Already a list",
  "1. First real item",
  "2. Second real item",
  "",
  "A paragraph with a link and footnote [1].",
].join("\n");

const sec = markdownToSection(normalizeContent(llmdoc), "s1", "");
if (!sec) throw new Error("section empty");

const blocks: Block[] = sec.blocks;
// inject a code block and a heading to exercise structured rendering
blocks.unshift({ type: "code", text: "const x = 1;\nreturn x;", language: "ts" });
blocks.push({ type: "heading", level: 3, inline: [{ type: "text", text: "Deep dive" }] });
blocks.push({ type: "paragraph", inline: [{ type: "text", text: "Final paragraph that should stay on the page with its heading above, and not be orphaned at the very bottom of a page because we add plenty of content to force page breaks." }] });

const doc: ExportDocument = {
  title: "Sample Notebook — Testing 123",
  author: "Jane Doe",
  metadata: {
    "Export date": new Date().toLocaleString(),
    Notebook: "Sample Notebook",
    Author: "Jane Doe",
    Sources: "3",
  },
  sections: [
    { key: "summary", title: "Summary / Key concepts", blocks },
    {
      key: "sources",
      title: "Sources overview",
      blocks: [
        {
          type: "table",
          columns: 3,
          header: [
            [{ type: "text", text: "Title", bold: true }],
            [{ type: "text", text: "Type" }],
            [{ type: "text", text: "Status" }],
          ],
          rows: [
            [[{ type: "text", text: "A" }], [{ type: "text", text: "pdf" }], [{ type: "text", text: "ready" }]],
            [[{ type: "text", text: "B" }], [{ type: "text", text: "video" }], [{ type: "text", text: "ready" }]],
            [[{ type: "text", text: "C" }], [{ type: "text", text: "web" }], [{ type: "text", text: "ready" }]],
          ],
        },
      ],
    },
  ],
  references: [
    { id: 1, sourceTitle: "A source", sourceType: "PDF", locator: "p. 3", originUrl: "https://example.com/a" },
  ],
};

(async () => {
  console.log("=== normalizeContent output ===");
  console.log(normalizeContent(llmdoc));
  console.log("=== block types ===");
  console.log(blocks.map((b) => b.type));

  const pdf = await renderPdf(doc);
  const docxBuf = await renderDocx(doc);

  const pdfPages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log("PDF bytes:", pdf.length, "magic:", JSON.stringify(pdf.slice(0, 5).toString("latin1")), "pages:", pdfPages);
  console.log("DOCX bytes:", docxBuf.length, "magic:", JSON.stringify(docxBuf.slice(0, 2).toString("latin1")));

  if (!pdf.slice(0, 5).toString("latin1").startsWith("%PDF")) throw new Error("bad PDF magic");
  if (docxBuf.slice(0, 2).toString("latin1") !== "PK") throw new Error("bad DOCX magic");
  if (pdfPages < 2) throw new Error("expected at least 2 pages");
  console.log("ALL OK");
})();
