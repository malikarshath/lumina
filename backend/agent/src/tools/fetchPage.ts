// Fetches a web page and returns its readable text (crude HTML strip, no dep).
// Used after web_search to ground the answer in the actual page, not just a snippet.
// 6000 chars of page text per fetch made a four-page answer a ~7k-token
// prompt, and every extra token is latency the user waits through before the
// first one comes back. 2000 is still a page of prose -- enough to ground a
// claim -- and measurably cheaper to read.
const FETCH_MAX_CHARS = Number(process.env.FETCH_MAX_CHARS) || 2000;

// Pages are fetched in parallel, so the SLOWEST one gates the whole answer:
// an 8s timeout let one unresponsive publisher spend the user's entire latency
// budget. At 2s a slow page is abandoned, traced as a failure, and the
// answer is grounded in the ones that did respond -- which is both faster and
// more honest than waiting to be sure.
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 2000;

/**
 * The page answered, and the answer was no.
 *
 * A 403 from a publisher that blocks crawlers is not a fault in this system --
 * it is the web declining, and it is information. Treating it the same as a
 * DNS failure or a dead socket means one paywalled result can turn a working
 * request into a 502. The loops use this to tell "we could not read anything"
 * (an honest empty answer) apart from "our fetching is broken" (fail loud).
 */
export class PageDeclined extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`fetch_page ${status} for ${url}`);
    this.name = "PageDeclined";
  }
}

export async function fetchPage(url: string, maxChars = FETCH_MAX_CHARS): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "LUMINA/1.0 (+research assistant)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new PageDeclined(res.status, url);

  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.slice(0, maxChars);
}
