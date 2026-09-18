import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { type AskRequest, TraceEvent, SourcesEvent, TokenEvent, DoneEvent } from "@lumina/contract";
import { anthropic, LLM_MODEL } from "../providers/anthropic.js";
import { tavilySearch, type WebResult } from "../tools/webSearch.js";
import { getCached, setCached } from "../tools/searchCache.js";
import { fetchPage } from "../tools/fetchPage.js";
import { getDb, isDbConfigured } from "../db/mongo.js";
import type { ToolCallLog } from "../observability/runLog.js";
import type { RunSummary } from "./askLoop.js";

type Emit = (event: string, data: unknown) => void;

// Deep Search has its own budget, entirely separate from the interactive
// loop's MAX_TOOL_CALLS/MAX_WALL_CLOCK_MS -- "Quick and Deep must stay
// separate" applies to caps, not just code paths.
const DEEP_MAX_SUBQUESTIONS = Number(process.env.DEEP_MAX_SUBQUESTIONS) || 4;
const DEEP_RESULTS_PER_SUBQ = Number(process.env.DEEP_RESULTS_PER_SUBQ) || 2;

const PLAN_SYSTEM = `Break the user's question into 2-4 focused, independently-researchable
sub-questions that together cover it well. Output ONLY valid JSON (no markdown fences)
matching exactly: {"subQuestions": string[]}`;

const SYNTHESIS_SYSTEM = `You are LUMINA's Deep Search mode. You have been given a set of
sub-questions and grounded evidence gathered for each of them, with numbered sources.
Write a comprehensive, well-organized answer to the ORIGINAL question that draws on
evidence from across the sub-questions. Cite every factual claim with [n], where n matches
the numbered sources you were given. Never invent a citation. If a sub-question's evidence
was thin, say so plainly for that part rather than filling the gap from your own knowledge.`;

async function planSubQuestions(query: string): Promise<{ subQuestions: string[]; inTok: number; outTok: number }> {
  const msg = await anthropic.messages.create({
    model: LLM_MODEL,
    max_tokens: 512,
    system: PLAN_SYSTEM,
    messages: [{ role: "user", content: query }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { subQuestions: string[] };
  return {
    subQuestions: parsed.subQuestions,
    inTok: msg.usage?.input_tokens ?? 0,
    outTok: msg.usage?.output_tokens ?? 0,
  };
}

type WebSrc = { n: number; kind: "web"; title: string; url: string; snippet: string };

// Planner -> parallel per-sub-question search -> parallel fetch across every
// sub-question's results at once -> merge -> one synthesis call over all of
// it. Deterministic retrieval per sub-question (not another agentic tool
// loop per sub-question) -- fast, cost-bounded, and still genuinely broader
// evidence-gathering than the single-question interactive loop.
export async function runDeepLoop(
  req: AskRequest,
  emit: Emit,
  userId: string,
  threadId: string,
): Promise<RunSummary> {
  const start = Date.now();
  let step = 0;
  let inTok = 0;
  let outTok = 0;
  let searchCalls = 0;
  let searchCached = false;
  const toolCallLog: ToolCallLog[] = [];

  // Step 1: plan.
  const planT0 = Date.now();
  const plan = await planSubQuestions(req.query);
  inTok += plan.inTok;
  outTok += plan.outTok;
  step++;
  toolCallLog.push({ name: "plan_subquestions", ok: true });
  emit(
    "trace",
    TraceEvent.parse({
      event: "trace",
      step,
      tool: "plan_subquestions",
      input: { query: req.query },
      ok: true,
      ms: Date.now() - planT0,
    }),
  );

  const subQuestions = plan.subQuestions.slice(0, DEEP_MAX_SUBQUESTIONS);
  const terminated: "done" | "cap" = plan.subQuestions.length > DEEP_MAX_SUBQUESTIONS ? "cap" : "done";

  // Step 2: search every sub-question concurrently.
  const searchOutcomes = await Promise.all(
    subQuestions.map(async (q) => {
      const t0 = Date.now();
      try {
        const cachedHit = await getCached(q);
        const found = cachedHit ?? (await tavilySearch(q));
        if (!cachedHit) await setCached(q, found);
        return { q, ms: Date.now() - t0, ok: true as const, cached: Boolean(cachedHit), found };
      } catch (err) {
        return { q, ms: Date.now() - t0, ok: false as const, error: String(err) };
      }
    }),
  );

  const toFetch: Array<{ subQuestion: string; title: string; url: string; snippet: string }> = [];
  for (const o of searchOutcomes) {
    step++;
    if (o.ok) {
      searchCached = searchCached || o.cached;
      if (!o.cached) searchCalls++;
      toolCallLog.push({ name: "web_search", ok: true });
      emit("trace", TraceEvent.parse({ event: "trace", step, tool: "web_search", input: { query: o.q }, ok: true, ms: o.ms }));
      for (const r of o.found.slice(0, DEEP_RESULTS_PER_SUBQ)) {
        toFetch.push({ subQuestion: o.q, title: r.title, url: r.url, snippet: r.snippet });
      }
    } else {
      toolCallLog.push({ name: "web_search", ok: false, error: o.error });
      emit("trace", TraceEvent.parse({ event: "trace", step, tool: "web_search", input: { query: o.q }, ok: false, ms: o.ms, error: o.error }));
    }
  }

  // Step 3: fetch every sub-question's top results concurrently, all at once
  // (not nested per sub-question) -- this is the actual breadth-without-time
  // win over running the sub-questions one after another.
  const fetchOutcomes = await Promise.all(
    toFetch.map(async (item) => {
      const t0 = Date.now();
      try {
        const text = await fetchPage(item.url);
        return { ...item, ms: Date.now() - t0, ok: true as const, text };
      } catch (err) {
        return { ...item, ms: Date.now() - t0, ok: false as const, error: String(err) };
      }
    }),
  );

  const sources: WebSrc[] = [];
  const grounded: Array<{ n: number; subQuestion: string; text: string }> = [];
  for (const o of fetchOutcomes) {
    step++;
    if (o.ok) {
      sources.push({ n: sources.length + 1, kind: "web", title: o.title, url: o.url, snippet: o.snippet });
      grounded.push({ n: sources.length, subQuestion: o.subQuestion, text: o.text.slice(0, 2500) });
      toolCallLog.push({ name: "fetch_page", ok: true });
      emit("trace", TraceEvent.parse({ event: "trace", step, tool: "fetch_page", input: { url: o.url, subQuestion: o.subQuestion }, ok: true, ms: o.ms }));
    } else {
      toolCallLog.push({ name: "fetch_page", ok: false, error: o.error });
      emit("trace", TraceEvent.parse({ event: "trace", step, tool: "fetch_page", input: { url: o.url, subQuestion: o.subQuestion }, ok: false, ms: o.ms, error: o.error }));
    }
  }

  emit("sources", SourcesEvent.parse({ event: "sources", sources }));

  let ttftMs = 0;
  let answerText = "";

  if (sources.length === 0) {
    // Empty retrieval -> say so, cite nothing (contract rule, same as the quick loop).
    ttftMs = Date.now() - start;
    answerText = "I wasn't able to retrieve any grounded evidence for this deep search across the sub-questions I planned. Please try rephrasing or narrowing the question.";
    emit("token", TokenEvent.parse({ event: "token", text: answerText }));
  } else {
    const evidenceBySubQ = subQuestions
      .map((q, i) => {
        const parts = grounded.filter((g) => g.subQuestion === q);
        if (parts.length === 0) return `${i + 1}. ${q}\n(no grounded evidence found for this sub-question)`;
        return `${i + 1}. ${q}\n${parts.map((p) => `[${p.n}] ${p.text}`).join("\n\n")}`;
      })
      .join("\n\n");

    const userContent = `Original question: ${req.query}\n\nSub-questions researched:\n${evidenceBySubQ}`;

    const stream = anthropic.messages.stream({
      model: LLM_MODEL,
      max_tokens: 2048,
      system: SYNTHESIS_SYSTEM,
      messages: [{ role: "user", content: userContent }],
      ...({ output_config: { effort: "low" } } as Record<string, unknown>),
    });
    stream.on("text", (delta) => {
      if (!ttftMs) ttftMs = Date.now() - start;
      answerText += delta;
      emit("token", TokenEvent.parse({ event: "token", text: delta }));
    });
    const msg = await stream.finalMessage();
    inTok += msg.usage?.input_tokens ?? 0;
    outTok += msg.usage?.output_tokens ?? 0;
  }

  const costUsd = (inTok / 1e6) * 3.0 + (outTok / 1e6) * 15.0 + searchCalls * 0.008;
  const answerId = "ans_" + randomUUID().slice(0, 8);

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
        mode: "deep",
        subQuestions,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error("failed to persist deep answer:", String(err));
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
