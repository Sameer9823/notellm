import pdf from "pdf-parse";

export type PdfExtractResult = {
  pages: { page: number; text: string }[];
  pageCount: number;
  fullText: string;
};

/**
 * pdf-parse gives us full text plus a page render callback, which we use to
 * capture per-page text so each chunk can cite an exact page number.
 */
export async function extractPdf(buffer: Buffer): Promise<PdfExtractResult> {
  const pages: { page: number; text: string }[] = [];
  let currentPage = 0;

  const data = await pdf(buffer, {
    // pdf-parse awaits this at runtime even though @types/pdf-parse's
    // signature (still) declares it as sync-returning-string.
    pagerender: (async (pageData: { getTextContent: () => Promise<{ items: { str?: string }[] }> }) => {
      currentPage += 1;
      const content = await pageData.getTextContent();
      const text = content.items.map((item) => item.str ?? "").join(" ");
      pages.push({ page: currentPage, text });
      return text;
    }) as unknown as (pageData: unknown) => string,
  });

  return { pages, pageCount: data.numpages, fullText: data.text };
}
