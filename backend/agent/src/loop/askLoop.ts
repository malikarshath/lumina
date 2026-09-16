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
import { searchDocuments } from "../rag/search.js";
import { recallMemory, saveMemory } from "../rag/memory.js";

type Emit = (event: string, data: unknown) => void;

const MAX_TOOL_CALLS = Number(process.env.MAX_TOOL_CALLS) || 8;
const MAX_WALL_CLOCK_MS = (Number(process.env.MAX_WALL_CLOCK_SEC) || 90) * 1000;

const SYSTEM = `You are LUMINA, a research assistant.
Use web_search for current/web information, and search_documents for questions
about the user's uploaded files. You may use both. Search before answering.
Use recall_memory when prior context about the user would help, and save_memory
to remember durable facts (preferences, identity, ongoing projects) for future sessions.
Write a concise, accurate answer and cite every factual claim with [n],
where n matches the numbered sources you were given in tool results.
If search returned nothing useful, say so plainly and cite nothing.
Never invent a citation or a source.`;

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
  {
    name: "search_documents",
    description:
      "Search the user's uploaded documents in the current space. Use for questions about their files. Returns numbered results.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "the search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "recall_memory",
    description:
      "Recall durable facts you previously saved about this user. Use when personalization or prior context helps.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "what to recall" } },
      required: ["query"],
    },
  },
  {
    name: "save_memory",
    description:
      "Save a durable fact about the user for future sessions (preferences, identity, ongoing projects). Use sparingly.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "the fact to remember" } },
      required: ["text"],
    },
  },
];

// Numbered source lines fed back to the model so it can cite [n].
function formatSources(
  items: Array<{ n: number; kind: "web" | "doc"; title: string; snippet: string; url?: string }>,
): string {
  return items
    .map((s) =>
      s.kind === "web"
        ? `[${s.n}] ${s.title}\n${s.snippet}\n${s.url}`
        : `[${s.n}] ${s.title}\n${s.snippet}`,
    )
    .join("\n\n");
}

export async function runAskLoop(req: AskRequest, emit: Emit, userId: string) {
  const start = Date.now();
  let ttftMs = 0;
  let toolCalls = 0;
  let step = 0;
  let sourcesSent = false;
  let terminated: "done" | "cap" = "done";
  let inTok = 0;
  let outTok = 0;
  let searchCalls = 0;

  // Sources accumulate across tool calls; emitted once, before the first token.
  type WebSrc = { n: number; kind: "web"; title: string; url: string; snippet: string };
  type DocSrc = {
    n: number;
    kind: "doc";
    docId: string;
    title: string;
    snippet: string;
    locator: { line?: number; page?: number; heading?: string };
  };
  const sources: Array<WebSrc | DocSrc> = [];

  // Memory tools are always available; search tools follow the request mode:
  // web -> web only, docs -> documents only, auto -> both.
  const activeTools = tools.filter((t) => {
    if (t.name === "recall_memory" || t.name === "save_memory") return true;
    if (req.mode === "web") return t.name === "web_search";
    if (req.mode === "docs") return t.name === "search_documents";
    return true; // auto
  });

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
      tools: activeTools,
      messages,
      // Low effort = minimal thinking before the first token -> lower TTFT.
      // Keeps tool-calling reliable (web_search still fires), unlike disabling thinking.
      // output_config.effort is GA on the API but not yet typed in SDK 0.68.
      ...({ output_config: { effort: "low" } } as Record<string, unknown>),
    });

    // Each text delta is one token event. Sources must precede the first token.
    stream.on("text", (delta) => {
      if (!ttftMs) ttftMs = Date.now() - start;
      ensureSourcesSent();
      emit("token", TokenEvent.parse({ event: "token", text: delta }));
    });

    const msg = await stream.finalMessage();
    inTok += msg.usage?.input_tokens ?? 0;
    outTok += msg.usage?.output_tokens ?? 0;

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
        const startN = sources.length;
        let resultText: string;

        if (t.name === "web_search") {
          const q = (t.input as { query: string }).query;
          searchCalls++;
          const found = await tavilySearch(q);
          for (const r of found) {
            sources.push({
              n: sources.length + 1,
              kind: "web",
              title: r.title,
              url: r.url,
              snippet: r.snippet,
            });
          }
          resultText = formatSources(sources.slice(startN));
        } else if (t.name === "search_documents") {
          const q = (t.input as { query: string }).query;
          if (!req.spaceId) {
            throw new Error("no document space selected for this request");
          }
          const hits = await searchDocuments(req.spaceId, q, 5);
          for (const hcap of hits) {
            sources.push({
              n: sources.length + 1,
              kind: "doc",
              docId: hcap.docId,
              title: hcap.title,
              snippet: hcap.text.slice(0, 300),
              locator: hcap.locator,
            });
          }
          resultText = formatSources(sources.slice(startN));
        } else if (t.name === "recall_memory") {
          const q = (t.input as { query: string }).query;
          const mems = await recallMemory(userId, q, 5);
          resultText = mems.length
            ? mems.map((m) => `(memory) ${m.text}`).join("\n")
            : "No relevant memories saved.";
        } else if (t.name === "save_memory") {
          const text = (t.input as { text: string }).text;
          await saveMemory(userId, text);
          resultText = "Saved to memory.";
        } else {
          throw new Error(`unknown tool: ${t.name}`);
        }

        emit(
          "trace",
          TraceEvent.parse({
            event: "trace",
            step,
            tool: t.name,
            input: t.input,
            ok: true,
            ms: Date.now() - t0,
          }),
        );
        results.push({
          type: "tool_result",
          tool_use_id: t.id,
          content: resultText || "No results found.",
        });
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

  // Cost model mirrors benchmark/sla.json cost_model (USD per million tokens + per search).
  const costUsd =
    (inTok / 1e6) * 3.0 + (outTok / 1e6) * 15.0 + searchCalls * 0.008;

  emit(
    "done",
    DoneEvent.parse({
      event: "done",
      answerId: "ans_" + randomUUID().slice(0, 8),
      latencyMs: Date.now() - start,
      ttftMs,
      model: LLM_MODEL,
      tokens: { in: inTok, out: outTok },
      costUsd: Number(costUsd.toFixed(6)),
      searchCached: false, // TODO: wire the search cache
      terminated,
    }),
  );
}
