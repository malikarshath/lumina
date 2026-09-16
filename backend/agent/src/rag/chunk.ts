export type Chunk = { text: string; locator: { line: number } };

// Simple character-window chunker with overlap. Tracks the 1-based line number
// where each chunk starts, so citations can point at a locator.
export function chunkText(text: string, maxChars = 1000, overlap = 150): Chunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const chunks: Chunk[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + maxChars, clean.length);
    const slice = clean.slice(start, end);
    const line = clean.slice(0, start).split("\n").length; // 1-based start line
    chunks.push({ text: slice, locator: { line } });
    if (end >= clean.length) break;
    start = end - overlap; // step back for overlap
  }
  return chunks;
}
