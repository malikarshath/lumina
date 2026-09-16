// Fetches a web page and returns its readable text (crude HTML strip, no dep).
// Used after web_search to ground the answer in the actual page, not just a snippet.
export async function fetchPage(url: string, maxChars = 6000): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "LUMINA/1.0 (+research assistant)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`fetch_page ${res.status} for ${url}`);

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
