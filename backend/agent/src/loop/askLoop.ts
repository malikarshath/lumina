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
import { tavilySearch, type WebResult } from "../tools/webSearch.js";
import { getCached, setCached } from "../tools/searchCache.js";
import { fetchPage } from "../tools/fetchPage.js";
import { searchDocuments, type DocHit } from "../rag/search.js";
import { recallMemory, saveMemory, type Memory } from "../rag/memory.js";
import { getDb, isDbConfigured } from "../db/mongo.js";
import type { ToolCallLog } from "../observability/runLog.js";

type Emit = (event: string, data: unknown) => void;

export type RunSummary = {
  answerId: string;
  tokens: number;
  wallClockSec: number;
  costUsd: number;
  terminated: "done" | "cap";
  toolCalls: ToolCallLog[];
  ttftMs: number;
  searchCached: boolean;
};

const MAX_TOOL_CALLS = Number(process.env.MAX_TOOL_CALLS) || 8;
const MAX_WALL_CLOCK_MS = (Number(process.env.MAX_WALL_CLOCK_SEC) || 90) * 1000;

const SYSTEM = `You are LUMINA, a research assistant. Ground every answer in retrieved
sources — never answer from your own prior knowledge without retrieving first.
In web/auto mode you MUST call web_search, then fetch_page on the results you will
cite, before writing the answer. In docs mode use search_documents. This applies even
to questions you think you know.
Use recall_memory when prior context about the user would help, and save_memory to
remember durable facts (preferences, identity, ongoing projects) for future sessions.
Write a concise, accurate answer and cite every factual claim with [n], where n matches
the numbered sources you were given in tool results.
If retrieval returned nothing useful, say so plainly and cite nothing. Never invent a citation.`;

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
    name: "fetch_page",
    description:
      "Fetch the full text of a web page by URL to ground your answer in the actual source. Use after web_search on the results you intend to cite, instead of relying on snippets alone.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "the page URL to fetch" } },
      required: ["url"],
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

export async function runAskLoop(
  req: AskRequest,
  emit: Emit,
  userId: string,
  threadId: string,
): Promise<RunSummary> {
  const start = Date.now();
  let ttftMs = 0;
  let toolCalls = 0;
  let step = 0;
  let sourcesSent = false;
  let terminated: "done" | "cap" = "done";
  let inTok = 0;
  let outTok = 0;
  let searchCalls = 0;
  let searchCached = false;
  let answerText = "";
  const toolCallLog: ToolCallLog[] = [];

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
    if (req.mode === "web") return t.name === "web_search" || t.name === "fetch_page";
    if (req.mode === "docs") return t.name === "search_documents";
    return true; // auto: all
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
      answerText += delta;
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

    // Phase 1: run every tool call's I/O concurrently. This is the actual
    // latency win -- when the model asks for e.g. three fetch_page calls in
    // one turn, they now overlap on the network instead of queuing one
    // after another (sequential cost t1+t2+t3 -> parallel cost max(t1,t2,t3)).
    // Nothing here touches `sources` -- that would race across concurrent
    // calls reading its length as a starting index. Retrieval only; no
    // shared-state mutation until phase 2.
    type Outcome =
      | { t: Anthropic.ToolUseBlock; ms: number; ok: true; kind: "web_search"; cached: boolean; found: WebResult[] }
      | { t: Anthropic.ToolUseBlock; ms: number; ok: true; kind: "fetch_page"; text: string }
      | { t: Anthropic.ToolUseBlock; ms: number; ok: true; kind: "search_documents"; hits: DocHit[] }
      | { t: Anthropic.ToolUseBlock; ms: number; ok: true; kind: "recall_memory"; mems: Memory[] }
      | { t: Anthropic.ToolUseBlock; ms: number; ok: true; kind: "save_memory" }
      | { t: Anthropic.ToolUseBlock; ms: number; ok: false; error: string };

    const outcomes: Outcome[] = await Promise.all(
      toolUses.map(async (t): Promise<Outcome> => {
        const t0 = Date.now();
        try {
          if (t.name === "web_search") {
            const q = (t.input as { query: string }).query;
            const cachedHit = await getCached(q);
            const found = cachedHit ?? (await tavilySearch(q));
            if (!cachedHit) await setCached(q, found);
            return { t, ms: Date.now() - t0, ok: true, kind: "web_search", cached: Boolean(cachedHit), found };
          }
          if (t.name === "fetch_page") {
            const url = (t.input as { url: string }).url;
            const text = await fetchPage(url);
            return { t, ms: Date.now() - t0, ok: true, kind: "fetch_page", text };
          }
          if (t.name === "search_documents") {
            const q = (t.input as { query: string }).query;
            if (!req.spaceId) throw new Error("no document space selected for this request");
            const hits = await searchDocuments(req.spaceId, q, 5);
            return { t, ms: Date.now() - t0, ok: true, kind: "search_documents", hits };
          }
          if (t.name === "recall_memory") {
            const q = (t.input as { query: string }).query;
            const mems = await recallMemory(userId, q, 5);
            return { t, ms: Date.now() - t0, ok: true, kind: "recall_memory", mems };
          }
          if (t.name === "save_memory") {
            const text = (t.input as { text: string }).text;
            await saveMemory(userId, text);
            return { t, ms: Date.now() - t0, ok: true, kind: "save_memory" };
          }
          throw new Error(`unknown tool: ${t.name}`);
        } catch (err) {
          return { t, ms: Date.now() - t0, ok: false, error: String(err) };
        }
      }),
    );

    // Phase 2: apply outcomes to shared state in original order -- sequential,
    // synchronous, no races on `sources`/`step`/`toolCallLog`.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const o of outcomes) {
      step++;
      toolCalls++;

      if (!o.ok) {
        // Fail loud: mark the trace ok:false with a non-empty error, in both
        // the SSE trace and the run log (A1's precedent: a swallowed error
        // that quietly serves a degraded answer instead of failing loud).
        toolCallLog.push({ name: o.t.name, ok: false, error: o.error });
        emit("trace", TraceEvent.parse({ event: "trace", step, tool: o.t.name, input: o.t.input, ok: false, ms: o.ms, error: o.error }));
        results.push({ type: "tool_result", tool_use_id: o.t.id, content: `Error: ${o.error}`, is_error: true });
        continue;
      }

      const startN = sources.length;
      let resultText: string;

      if (o.kind === "web_search") {
        searchCached = searchCached || o.cached;
        if (!o.cached) searchCalls++;
        for (const r of o.found) {
          sources.push({ n: sources.length + 1, kind: "web", title: r.title, url: r.url, snippet: r.snippet });
        }
        // Return titles + URLs only (no content) so the model must fetch_page
        // the results it will cite — grounding in the real page, not snippets.
        resultText =
          sources
            .slice(startN)
            .map((s) => `[${s.n}] ${s.title} — ${(s as { url?: string }).url}`)
            .join("\n") +
          "\n\nCall fetch_page(url) on the results you will cite to read the full page before answering.";
      } else if (o.kind === "fetch_page") {
        resultText = o.text;
      } else if (o.kind === "search_documents") {
        for (const hcap of o.hits) {
          sources.push({
            n: sources.length + 1,
            kind: "doc",
            docId: hcap.docId,
            title: hcap.title,
            // Full chunk text, not a 300-char clip: a chunk is already a
            // bounded, citation-sized unit (chunkText caps it ~1000 chars),
            // and truncating it further only hides real, retrieved grounding
            // from both the model's citation and anything checking recall.
            snippet: hcap.text,
            locator: hcap.locator,
          });
        }
        resultText = formatSources(sources.slice(startN));
      } else if (o.kind === "recall_memory") {
        resultText = o.mems.length ? o.mems.map((m) => `(memory) ${m.text}`).join("\n") : "No relevant memories saved.";
      } else {
        resultText = "Saved to memory.";
      }

      toolCallLog.push({ name: o.t.name, ok: true });
      emit("trace", TraceEvent.parse({ event: "trace", step, tool: o.t.name, input: o.t.input, ok: true, ms: o.ms }));
      results.push({ type: "tool_result", tool_use_id: o.t.id, content: resultText || "No results found." });
    }
    messages.push({ role: "user", content: results });
  }

  ensureSourcesSent(); // covers the "answered with no tools" path

  // Cost model mirrors benchmark/sla.json cost_model (USD per million tokens + per search).
  const costUsd =
    (inTok / 1e6) * 3.0 + (outTok / 1e6) * 15.0 + searchCalls * 0.008;

  const answerId = "ans_" + randomUUID().slice(0, 8);

  // Persist the answer + its sources so POST /artifacts can build a deck from
  // it later. Best-effort: a DB hiccup here must never turn a good answer into
  // a failed request — the SSE stream already delivered it to the client.
  if (isDbConfigured()) {
    try {
      const db = await getDb();
      await db.collection("answers").insertOne({
        answerId,
        threadId,
        userId,
        query: req.query,
        text: answerText,
        sources,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error("failed to persist answer:", String(err));
    }
  }

  emit(
    "done",
    DoneEvent.parse({
      event: "done",
      answerId,
      latencyMs: Date.now() - start,
      ttftMs,
      model: LLM_MODEL,
      tokens: { in: inTok, out: outTok },
      costUsd: Number(costUsd.toFixed(6)),
      searchCached,
      terminated,
    }),
  );

  return {
    answerId,
    tokens: inTok + outTok,
    wallClockSec: Number(((Date.now() - start) / 1000).toFixed(3)),
    costUsd: Number(costUsd.toFixed(6)),
    terminated,
    toolCalls: toolCallLog,
    ttftMs,
    searchCached,
  };
}
