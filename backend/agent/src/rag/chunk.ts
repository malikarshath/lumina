import type { ParsedPage } from "./parse.js";

export type Locator = { page?: number; heading?: string; line?: number };
export type Chunk = { text: string; locator: Locator };

const MAX_CHARS = Number(process.env.RAG_CHUNK_CHARS) || 1000;
const OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP) || 150;

/** Character-window split with overlap. Shared by every parser above it. */
function windows(text: string, maxChars: number, overlap: number): Array<{ text: string; start: number }> {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const out: Array<{ text: string; start: number }> = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + maxChars, clean.length);
    out.push({ text: clean.slice(start, end), start });
    if (end >= clean.length) break;
    start = end - overlap; // step back so a sentence is never split away from its context
  }
  return out;
}

/**
 * Chunks a PDF page by page, so every chunk carries the page it came from.
 *
 * Chunking never spans a page boundary. A chunk that straddles p. 3 and p. 4
 * cannot honestly claim either number, and "roughly page 3" is not a citation
 * a reader can check.
 */
export function chunkPages(pages: ParsedPage[], maxChars = MAX_CHARS, overlap = OVERLAP): Chunk[] {
  return pages.flatMap((p) =>
    windows(p.text, maxChars, overlap).map(({ text }) => ({ text, locator: { page: p.page } })),
  );
}

/**
 * Chunks plain text or markdown, carrying the nearest preceding markdown
 * heading when there is one and the start line otherwise. A heading is a far
 * more useful citation than a line number -- it survives the document being
 * edited, and it is what a reader would quote.
 */
export function chunkText(text: string, maxChars = MAX_CHARS, overlap = OVERLAP): Chunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  // Line index -> the heading in force at that line.
  const lines = clean.split("\n");
  const headingAt: Array<string | undefined> = [];
  let current: string | undefined;
  for (const line of lines) {
    const m = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (m) current = m[1];
    headingAt.push(current);
  }

  return windows(clean, maxChars, overlap).map(({ text: slice, start }) => {
    const line = clean.slice(0, start).split("\n").length; // 1-based start line
    const heading = headingAt[line - 1];
    return { text: slice, locator: heading ? { heading, line } : { line } };
  });
}
