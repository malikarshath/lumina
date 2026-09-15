export type WebResult = { title: string; url: string; snippet: string };

// Calls Tavily's REST API. Throws on a non-200 so the loop can fail loud.
export async function tavilySearch(query: string): Promise<WebResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: 5,
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
