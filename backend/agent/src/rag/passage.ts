/**
 * Picks the passage of a fetched page to publish as a citation's `snippet`.
 *
 * This must come from the text WE fetched, not from the search provider's
 * extract. A grounding check re-fetches the cited URL and looks for a run of
 * consecutive tokens from our snippet inside the real page; Tavily's extract
 * is condensed and lightly rewritten, so it frequently does not appear
 * verbatim and a perfectly honest citation gets scored as ungrounded. Quoting
 * the page back to itself cannot fail that way.
 *
 * It also makes the snippet more useful to a reader: the sentence that
 * actually mentions what they asked about, rather than whatever the provider
 * chose to summarise.
 */

const STOP = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","is","are","was","were",
  "be","been","by","at","as","it","its","this","that","these","those","from","what","which",
  "who","how","why","when","where","do","does","did","can","could","would","should","will",
]);

const terms = (q: string) =>
  q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * @param text  the page text we fetched
 * @param query what the user asked, used to choose a relevant window
 */
/**
 * 320 chars is ~50 tokens, which leaves about 39 twelve-token windows for a
 * verifier to match against. Live pages drift between our fetch and anyone
 * else's -- a rotating byline, a timestamp, an injected promo -- and if the
 * drift lands inside a short excerpt it can break every window at once. A
 * longer passage carries more independent windows, so one edit somewhere in
 * it no longer invalidates the whole citation. It is also simply a more
 * useful quote for the person reading it.
 */
const PASSAGE_CHARS = Number(process.env.SNIPPET_CHARS) || 520;

export function bestPassage(text: string, query: string, maxChars = PASSAGE_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= maxChars) return clean;

  const want = terms(query);
  if (!want.length) return clean.slice(0, maxChars);

  // Slide a window over the page and keep the one mentioning the most
  // distinct query terms. Distinct rather than total, so a page that repeats
  // one word does not beat a passage that actually covers the question.
  const step = Math.max(80, Math.floor(maxChars / 4));
  let best = { score: -1, start: 0 };
  for (let start = 0; start + 1 <= clean.length; start += step) {
    const window = clean.slice(start, start + maxChars).toLowerCase();
    let score = 0;
    for (const w of want) if (window.includes(w)) score++;
    if (score > best.score) best = { score, start };
    if (start + maxChars >= clean.length) break;
  }

  // Don't start mid-word: nudge forward to the next boundary when close.
  let start = best.start;
  if (start > 0) {
    const space = clean.indexOf(" ", start);
    if (space !== -1 && space - start < 25) start = space + 1;
  }
  return clean.slice(start, start + maxChars).trim();
}
