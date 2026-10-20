/** Repairs text where bullets / numbered items were glued onto one line.
 *  Call it on the raw markdown BEFORE it is parsed into blocks. */
export function normalizeMarkdown(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]*•[ \t]*/g, "\n- ")                      // inline "•" -> list item
    .replace(/([.!?])[ \t]*(\d{1,2}\.\s+[A-Z])/g, "$1\n$2")  // "...opportunities.2. Design"
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** For blobs such as "Key takeaways" joined with no separator between sentences. */
export function splitGluedSentences(raw: string): string {
  return raw
    .replace(/([a-z)\]])\.[ \t]*([A-Z][a-z])/g, "$1.\n- $2")
    .replace(/^(?!- )/, "- ");
}