// Browser-side reader for the /ask SSE stream. EventSource only does GET,
// and our /ask is a POST, so we read the fetch body stream and parse frames.

export type Source = {
  n: number;
  kind: "web" | "doc";
  title: string;
  url?: string;
  snippet?: string;
};

export type AskHandlers = {
  onTrace?: (d: { tool: string; input: unknown; ok: boolean; ms: number }) => void;
  onSources?: (sources: Source[]) => void;
  onToken?: (text: string) => void;
  onDone?: (d: { latencyMs: number; ttftMs: number; terminated: string }) => void;
  onError?: (d: { status?: number; error: string }) => void;
};

export async function askStream(
  gatewayUrl: string,
  threadId: string,
  query: string,
  mode: string,
  userId: string,
  h: AskHandlers,
  spaceId?: string,
) {
  const body: Record<string, unknown> = { query, mode };
  if (spaceId) body.spaceId = spaceId;
  const res = await fetch(`${gatewayUrl}/threads/${threadId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": userId },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    h.onError?.({ status: res.status, error: await res.text() });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line. Keep the last (possibly partial) piece.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (event === "trace") h.onTrace?.(parsed);
      else if (event === "sources") h.onSources?.(parsed.sources);
      else if (event === "token") h.onToken?.(parsed.text);
      else if (event === "done") h.onDone?.(parsed);
      else if (event === "error") h.onError?.(parsed);
    }
  }
}
