// Browser-side reader for the /ask SSE stream. EventSource only does GET,
// and our /ask is a POST, so we read the fetch body stream and parse frames.

// Types come from the provided contract, not from hand-written copies here.
// That is the whole point of packages/contract: if the backend's payloads and
// the UI's expectations drift apart, this file stops compiling instead of
// rendering nothing at runtime.
import type {
  DoneEvent,
  PlanEvent,
  Source,
  StreamErrorEvent,
  SubQuestion,
  TraceEvent,
} from "@lumina/contract";

export type { Source, SubQuestion };
/** One row in the trace panel. */
export type TraceStep = TraceEvent;

export type AskHandlers = {
  // Deep search streams the plan before any retrieval, so the reader sees what
  // it decided to go and find out before the evidence starts arriving.
  onPlan?: (d: PlanEvent) => void;
  onTrace?: (d: TraceEvent) => void;
  onSources?: (sources: Source[]) => void;
  onToken?: (text: string) => void;
  onDone?: (d: DoneEvent) => void;
  onError?: (d: StreamErrorEvent) => void;
};

export async function askStream(
  gatewayUrl: string,
  threadId: string,
  query: string,
  mode: string,
  depth: string,
  userId: string,
  h: AskHandlers,
  spaceId?: string,
) {
  const body: Record<string, unknown> = { query, mode, depth };
  if (spaceId) body.spaceId = spaceId;
  const res = await fetch(`${gatewayUrl}/threads/${threadId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": userId },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    // The deep daily cap answers 429 {error, resetsAt} before the stream opens,
    // so surface both rather than dumping raw JSON at the user.
    const text = await res.text();
    let message = text;
    try {
      const body = JSON.parse(text) as { error?: string; resetsAt?: string };
      if (body.error) {
        message = body.resetsAt ? `${body.error} — resets at ${body.resetsAt}` : body.error;
      }
    } catch {
      // not JSON; the raw text is the most useful thing we have
    }
    h.onError?.({ status: res.status, error: message });
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
      if (event === "plan") h.onPlan?.(parsed);
      else if (event === "trace") h.onTrace?.(parsed);
      // The sources frame's payload IS the array (contract: SourcesEvent =
      // z.array(Source)), not an object wrapping one.
      else if (event === "sources") h.onSources?.(parsed);
      else if (event === "token") h.onToken?.(parsed.text);
      else if (event === "done") h.onDone?.(parsed);
      else if (event === "error") h.onError?.(parsed);
    }
  }
}
