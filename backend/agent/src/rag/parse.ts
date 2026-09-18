/**
 * Document parsing, page-aware.
 *
 * A citation is only checkable if it says WHERE in the document it came from,
 * so the parser's job is not "get the text out" but "get the text out without
 * losing which page it was on". Whole-document text extraction (pdf-parse and
 * friends) makes that information unrecoverable: once the pages are
 * concatenated, no amount of chunking can tell you that a passage was on p. 4.
 */

export type ParsedPage = { page: number; text: string };

/**
 * Extracts one text block per PDF page using pdfjs-dist.
 *
 * pdfjs is a browser library; the `legacy` build is the one that runs on Node
 * without a DOM. Page numbers here are 1-based, matching how a human cites a
 * PDF and how the gold set records its answers.
 */
export async function parsePdfPages(buffer: Buffer): Promise<ParsedPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const doc = await pdfjs.getDocument({
    // pdfjs mutates the buffer it is handed, so give it its own copy.
    data: new Uint8Array(buffer),
    // Nothing here should reach the network or load system fonts: this runs
    // on a server against files a user uploaded.
    useWorkerFetch: false,
    useSystemFonts: false,
  }).promise;

  const pages: ParsedPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    // pdfjs returns positioned text runs, not lines. Joining on a space and
    // collapsing runs is enough for retrieval; `hasEOL` marks a line break,
    // which keeps words from being glued across lines.
    const text = content.items
      .map((item) => {
        const run = item as { str?: string; hasEOL?: boolean };
        if (typeof run.str !== "string") return "";
        return run.hasEOL ? `${run.str}\n` : run.str;
      })
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .trim();
    pages.push({ page: n, text });
    page.cleanup();
  }
  // Releases the worker and the parsed document; without it a long-lived
  // worker process leaks a little more memory with every upload.
  await doc.cleanup();
  return pages;
}
