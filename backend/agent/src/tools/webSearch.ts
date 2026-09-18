export type WebResult = { title: string; url: string; snippet: string };

// SEARCH_PROVIDER picks the backend at call time, so a deployment swaps
// providers by changing one env var and restarting -- no code change. Read per
// call rather than captured at module load so a test can flip it.
const provider = () => (process.env.SEARCH_PROVIDER ?? "tavily").toLowerCase();

const MAX_RESULTS = Number(process.env.SEARCH_MAX_RESULTS) || 5;

// Calls Tavily's REST API. Throws on a non-200 so the loop can fail loud.
async function tavily(query: string): Promise<WebResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: MAX_RESULTS,
      search_depth: "basic",
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    results: Array<{ title: string; url: string; content: string }>;
  };

  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

// SerpApi's Google engine. Same contract as tavily(): normalized WebResult[]
// or a thrown error, so the loops never learn which provider answered.
async function serpapi(query: string): Promise<WebResult[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(MAX_RESULTS));
  url.searchParams.set("api_key", process.env.SERPAPI_API_KEY ?? "");

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw new Error(`SerpApi ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    error?: string;
    organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  // SerpApi reports quota and key problems as 200 + {error}. Left unchecked
  // that reads as "no results found" instead of the failure it is.
  if (data.error) throw new Error(`SerpApi: ${data.error}`);

  return (data.organic_results ?? [])
    .filter((r): r is { title: string; link: string; snippet?: string } => Boolean(r.title && r.link))
    .slice(0, MAX_RESULTS)
    .map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "" }));
}

export async function webSearch(query: string): Promise<WebResult[]> {
  const name = provider();
  if (name === "tavily") return tavily(query);
  if (name === "serpapi") return serpapi(query);
  // An unknown provider is a config error, not a reason to silently pick one.
  throw new Error(`unknown SEARCH_PROVIDER "${name}" (expected tavily | serpapi)`);
}