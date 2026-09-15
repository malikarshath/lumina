import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import {
  type AskRequest,
  TraceEvent,
  SourcesEvent,
  TokenEvent,
  DoneEvent,
} from "@lumina/contract";
import { anthropic, LLM_MODEL } from "../providers/anthropic.js";
import { tavilySearch } from "../tools/webSearch.js";

type Emit = (event: string, data: unknown) => void;

const MAX_TOOL_CALLS = Number(process.env.MAX_TOOL_CALLS) || 8;
const MAX_WALL_CLOCK_MS = (Number(process.env.MAX_WALL_CLOCK_SEC) || 90) * 1000;

const SYSTEM = `You are LUMINA, a web research assistant.
Use the web_search tool to find current information before answering.
Write a concise, accurate answer and cite every factual claim with [n],
where n matches the numbered sources you were given in tool results.
If search returned nothing useful, say so plainly and cite nothing.
Never invent a citation or a source.`;

// One custom tool: web_search. (fetch_page, search_documents, memory come later.)
const tools: Anthropic.Tool[] = [
  {
    name: "web_search",
    description:
      "Search the web for current information. Returns numbered results with titles, snippets, and URLs.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "the search query" },
      },
      required: ["query"],
    },
  },
];

export async function runAskLoop(req: AskRequest, emit: Emit) {
  const start = Date.now();
  let ttftMs = 0;
  let toolCalls = 0;
  let step = 0;
  let sourcesSent = false;
  let terminated: "done" | "cap" = "done";

  // Sources accumulate across tool calls; emitted once, before the first token.
  const sources: Array<{
    n: number;
    kind: "web";
    title: string;
    url: string;
    snippet: string;
  }> = [];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: req.query },
  ];

  const ensureSourcesSent = () => {
    if (!sourcesSent) {
      emit("sources", SourcesEvent.parse({ event: "sources", sources }));
      sourcesSent = true;
    }
  };

  while (true) {
    // Hard caps: your DESIGN.md trade-off, enforced here.
    if (toolCalls >= MAX_TOOL_CALLS || Date.now() - start > MAX_WALL_CLOCK_MS) {
      terminated = "cap";
      break;
    }

    const stream = anthropic.messages.stream({
      model: LLM_MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools,
      messages,
    });

    // Each text delta is one token event. Sources must precede the first token.
    stream.on("text", (delta) => {
      if (!ttftMs) ttftMs = Date.now() - start;
      ensureSourcesSent();
      emit("token", TokenEvent.parse({ event: "token", text: delta }));
    });

    const msg = await stream.finalMessage();

    // The model produced its final answer (no more tools) -> done.
    if (msg.stop_reason === "end_turn") break;

    const toolUses = msg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) break; // nothing to do; stop.

    // Record the assistant turn (including its tool_use blocks) in history.
    messages.push({ role: "assistant", content: msg.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      step++;
      toolCalls++;
      const t0 = Date.now();
      try {
        if (t.name === "web_search") {
          const q = (t.input as { query: string }).query;
          const found = await tavilySearch(q);
          const startN = sources.length;
          for (const r of found) {
            sources.push({
              n: sources.length + 1,
              kind: "web",
              title: r.title,
              url: r.url,
              snippet: r.snippet,
            });
          }
          emit(
            "trace",
            TraceEvent.parse({
              event: "trace",
              step,
              tool: "web_search",
              input: { query: q },
              ok: true,
              ms: Date.now() - t0,
            }),
          );
          // Feed the model the numbered results so it can cite [n].
          const numbered = sources
            .slice(startN)
            .map((s) => `[${s.n}] ${s.title}\n${s.snippet}\n${s.url}`)
            .join("\n\n");
          results.push({
            type: "tool_result",
            tool_use_id: t.id,
            content: numbered || "No results found.",
          });
        } else {
          throw new Error(`unknown tool: ${t.name}`);
        }
      } catch (err) {
        // Fail loud: mark the trace ok:false with a non-empty error.
        emit(
          "trace",
          TraceEvent.parse({
            event: "trace",
            step,
            tool: t.name,
            input: t.input,
            ok: false,
            ms: Date.now() - t0,
            error: String(err),
          }),
        );
        results.push({
          type: "tool_result",
          tool_use_id: t.id,
          content: `Error: ${String(err)}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  ensureSourcesSent(); // covers the "answered with no tools" path
  emit(
    "done",
    DoneEvent.parse({
      event: "done",
      answerId: "ans_" + randomUUID().slice(0, 8),
      latencyMs: Date.now() - start,
      ttftMs,
      model: LLM_MODEL,
      tokens: { in: 0, out: 0 }, // TODO: sum from stream usage
      costUsd: 0, // TODO: compute from usage + sla cost model
      searchCached: false, // TODO: wire the search cache
      terminated,
    }),
  );
}
