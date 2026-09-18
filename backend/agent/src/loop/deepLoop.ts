import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import {
  type AskBody,
  type SubQuestion,
  PlanEvent,
  TraceEvent,
  SourcesEvent,
  TokenEvent,
  DoneEvent,
} from "@lumina/contract";
import { anthropic, LLM_MODEL } from "../providers/anthropic.js";
import { webSearch } from "../tools/webSearch.js";
import { getCached, setCached, SearchCacheTally } from "../tools/searchCache.js";
import { loadThreadHistory } from "./threadHistory.js";
import { LoopFailure } from "./loopFailure.js";
import { fetchPage } from "../tools/fetchPage.js";
import { getDb, isDbConfigured } from "../db/mongo.js";
import type { ToolCallLog } from "../observability/runLog.js";
import type { RunSummary } from "./askLoop.js";

type Emit = (event: string, data: unknown) => void;

// Deep Search has its own budget, entirely separate from the interactive
// loop's MAX_TOOL_CALLS/MAX_WALL_CLOCK_SEC -- "Quick and Deep must stay
// separate" applies to caps, not just code paths.
const DEEP_SUB_QUESTIONS_MIN = Number(process.env.DEEP_SUB_QUESTIONS_MIN) || 3;
const DEEP_SUB_QUESTIONS_MAX = Number(process.env.DEEP_SUB_QUESTIONS_MAX) || 5;
const DEEP_RESULTS_PER_SUBQ = Number(process.env.DEEP_RESULTS_PER_SUBQ) || 3;
const DEEP_MAX_TOOL_CALLS = Number(process.env.MAX_TOOL_CALLS_DEEP) || 24;
const DEEP_MAX_WALL_CLOCK_MS = (Number(process.env.MAX_WALL_CLOCK_SEC_DEEP) || 240) * 1000;

const PLAN_SYSTEM = `Break the user's question into ${DEEP_SUB_QUESTIONS_MIN}-${DEEP_SUB_QUESTIONS_MAX}
focused, independently-researchable sub-questions that together cover it well. Each needs a
one-line reason explaining why answering it is necessary to answer the original question.
Never fewer than ${DEEP_SUB_QUESTIONS_MIN}. Output ONLY valid JSON (no markdown fences) matching
exactly: {"subQuestions": [{"question": string, "reason": string}]}`;

const SYNTHESIS_SYSTEM = `You are LUMINA's Deep Search mode. You have been given a set of
sub-questions and grounded evidence gathered for each of them, with numbered sources.
Write a comprehensive, well-organized answer to the ORIGINAL question that draws on
evidence from across the sub-questions. Cite every factual claim with [n], where n matches
the numbered sources you were given. Never invent a citation. If a sub-question's evidence
was thin, say so plainly for that part rather than filling the gap from your own knowledge.`;

async function planOnce(
  query: string,
): Promise<{ subQuestions: SubQuestion[]; inTok: number; outTok: number }> {
  const msg = await anthropic.messages.create({
    model: LLM_MODEL,
    // Room for the max number of sub-questions AND a reason for each. Too small
    // a budget truncates the JSON mid-string, which reads as a parse error
    // rather than as the budget problem it actually is.
    max_tokens: 1500,
    system: PLAN_SYSTEM,
    messages: [{ role: "user", content: query }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned) as {
    subQuestions: Array<{ question: string; reason?: string } | string>;
  };
  // Tolerate a bare string array (older prompt shape) without losing the index,
  // which every trace step and source is about to be tagged with.
  const subQuestions = parsed.subQuestions.slice(0, DEEP_SUB_QUESTIONS_MAX).map((sq, idx) => ({
    i: idx + 1,
    question: typeof sq === "string" ? sq : sq.question,
    ...(typeof sq === "string" ? {} : sq.reason ? { reason: sq.reason } : {}),
  }));
  if (subQuestions.length < DEEP_SUB_QUESTIONS_MIN) {
    throw new Error(
      `planner returned ${subQuestions.length} sub-questions, need at least ${DEEP_SUB_QUESTIONS_MIN}`,
    );
  }
  return {
    subQuestions,
    inTok: msg.usage?.input_tokens ?? 0,
    outTok: msg.usage?.output_tokens ?? 0,
  };
}

// One retry, because a plan is a single non-streamed generation and a one-off
// malformed or too-short response would otherwise sink an entire deep run.
// The second failure is thrown, not papered over: a deep search with no plan
// must fail loudly rather than quietly degrade into a slow quick search.
async function planResearch(query: string) {
  try {
    return await planOnce(query);
  } catch (first) {
    console.warn("plan_research retrying after:", String(first));
    return await planOnce(query);
  }
}

type WebSrc = {
  n: number;
  kind: "web";
  title: string;
  url: string;
  snippet: string;
  subQuestion: number;
};

// plan_research -> parallel per-sub-question search -> parallel fetch across every
// sub-question's results at once -> merge into one deduped citation numbering ->
// one synthesis call over all of it. Deterministic retrieval per sub-question
// (not another agentic tool loop per sub-question) -- fast, cost-bounded, and
// still genuinely broader evidence-gathering than the quick loop.
export async function runDeepLoop(
  req: AskBody,
  emit: Emit,
  userId: string,
  threadId: string,
): Promise<RunSummary> {
  const start = Date.now();
  let step = 0;
  let inTok = 0;
  let outTok = 0;
  const searchTally = new SearchCacheTally();
  let terminated: "done" | "cap" = "done";
  const toolCallLog: ToolCallLog[] = [];

  const overBudget = () =>
    toolCallLog.length >= DEEP_MAX_TOOL_CALLS || Date.now() - start > DEEP_MAX_WALL_CLOCK_MS;

  // Step 1: plan. This runs before any retrieval, and the plan is streamed as
  // its own `plan` event before the first trace step -- a plan emitted after
  // the fetches would be a rationalisation, not a plan.
  const planT0 = Date.now();
  const plan = await planResearch(req.query);
  inTok += plan.inTok;
  outTok += plan.outTok;
  const subQuestions = plan.subQuestions;

  emit("plan", PlanEvent.parse({ subQuestions }));

  step++;
  toolCallLog.push({ name: "plan_research", ok: true });
  emit(
    "trace",
    TraceEvent.parse({
      step,
      tool: "plan_research",
      input: { query: req.query },
      ok: true,
      ms: Date.now() - planT0,
      reason: `decomposed into ${subQuestions.length} sub-questions`,
    }),
  );

  // Step 2: research each sub-question as a UNIT -- its own search, then the
  // fetches that search turned up. The units run concurrently (that is the
  // breadth-without-time win), but a unit does not wait for anyone else's
  // search to finish before reading its own pages, which is both faster than
  // two global phases and produces a trace that reads in the order the work
  // actually happened: search, then the pages that search found.
  type Fetched =
    | { url: string; title: string; snippet: string; ms: number; ok: true; text: string }
    | { url: string; title: string; snippet: string; ms: number; ok: false; error: string };

  // Two sub-questions often surface the same page. Claimed synchronously the
  // moment a search returns, so the fetch budget is spent on pages nobody has
  // read yet and one page never takes two citation numbers.
  const claimedUrls = new Set<string>();

  const units = await Promise.all(
    subQuestions.map(async (sq) => {
      const searchT0 = Date.now();
      let search:
        | { ok: true; ms: number; cached: boolean; found: Awaited<ReturnType<typeof webSearch>> }
        | { ok: false; ms: number; error: string };
      try {
        const cachedHit = await getCached(sq.question);
        const found = cachedHit ?? (await webSearch(sq.question));
        if (!cachedHit) await setCached(sq.question, found);
        search = { ok: true, ms: Date.now() - searchT0, cached: Boolean(cachedHit), found };
      } catch (err) {
        return { sq, search: { ok: false as const, ms: Date.now() - searchT0, error: String(err) }, fetches: [] as Fetched[] };
      }

      const targets = search.found
        .filter((r) => {
          if (claimedUrls.has(r.url)) return false;
          claimedUrls.add(r.url);
          return true;
        })
        .slice(0, DEEP_RESULTS_PER_SUBQ);

      const fetches: Fetched[] = await Promise.all(
        targets.map(async (r): Promise<Fetched> => {
          const t0 = Date.now();
          try {
            const text = await fetchPage(r.url);
            return { url: r.url, title: r.title, snippet: r.snippet, ms: Date.now() - t0, ok: true, text };
          } catch (err) {
            return { url: r.url, title: r.title, snippet: r.snippet, ms: Date.now() - t0, ok: false, error: String(err) };
          }
        }),
      );
      return { sq, search, fetches };
    }),
  );

  // Step 3: merge into ONE contiguous citation numbering across every
  // sub-question, each source tagged with the sub-question that found it.
  const sources: WebSrc[] = [];
  const grounded: Array<{ n: number; subQuestion: number; text: string }> = [];

  // Retrieval that returned nothing and retrieval that threw are different
  // events and must not produce the same answer. Counted so the empty case
  // below can tell them apart.
  let searchOk = 0;
  let searchFailed = 0;
  let fetchOk = 0;
  let fetchFailed = 0;

  for (const unit of units) {
    step++;
    if (unit.search.ok) {
      searchOk++;
      searchTally.record(unit.search.cached);
      toolCallLog.push({ name: "web_search", ok: true });
      emit("trace", TraceEvent.parse({ step, tool: "web_search", input: { query: unit.sq.question }, ok: true, ms: unit.search.ms, subQuestion: unit.sq.i }));
    } else {
      searchFailed++;
      toolCallLog.push({ name: "web_search", ok: false, error: unit.search.error });
      emit("trace", TraceEvent.parse({ step, tool: "web_search", input: { query: unit.sq.question }, ok: false, ms: unit.search.ms, error: unit.search.error, subQuestion: unit.sq.i }));
      continue;
    }

    for (const f of unit.fetches) {
      if (toolCallLog.length >= DEEP_MAX_TOOL_CALLS) {
        terminated = "cap";
        break;
      }
      step++;
      if (f.ok) {
        fetchOk++;
        const n = sources.length + 1;
        sources.push({ n, kind: "web", title: f.title, url: f.url, snippet: f.snippet, subQuestion: unit.sq.i });
        grounded.push({ n, subQuestion: unit.sq.i, text: f.text.slice(0, 2500) });
        toolCallLog.push({ name: "fetch_page", ok: true });
        emit("trace", TraceEvent.parse({ step, tool: "fetch_page", input: { url: f.url }, ok: true, ms: f.ms, subQuestion: unit.sq.i }));
      } else {
        fetchFailed++;
        toolCallLog.push({ name: "fetch_page", ok: false, error: f.error });
        emit("trace", TraceEvent.parse({ step, tool: "fetch_page", input: { url: f.url }, ok: false, ms: f.ms, error: f.error, subQuestion: unit.sq.i }));
      }
    }
  }

  if (overBudget()) terminated = "cap";

  // Fail loud. An empty answer is only honest when retrieval genuinely found
  // nothing; when every search threw (bad key, provider down) or every page
  // fetch threw, telling the user "I couldn't find evidence" reports a search
  // result for what was actually an outage -- and returns 200 for it. Throwing
  // here reaches the ask route, which emits the SSE error with status 502 and
  // records terminated: "error".
  if (sources.length === 0) {
    if (searchOk === 0 && searchFailed > 0) {
      throw new LoopFailure(
        `deep search failed: all ${searchFailed} sub-question searches threw`,
        toolCallLog,
        { in: inTok, out: outTok },
        (inTok / 1e6) * 3.0 + (outTok / 1e6) * 15.0,
      );
    }
    if (fetchOk === 0 && fetchFailed > 0) {
      throw new LoopFailure(
        `deep search failed: all ${fetchFailed} page fetches threw`,
        toolCallLog,
        { in: inTok, out: outTok },
        (inTok / 1e6) * 3.0 + (outTok / 1e6) * 15.0,
      );
    }
  }

  emit("sources", SourcesEvent.parse(sources));

  let ttftMs = 0;
  let answerText = "";

  if (sources.length === 0) {
    // Genuinely empty retrieval (searches ran and returned nothing to read):
    // say so, cite nothing. The failure cases were thrown above.
    ttftMs = Date.now() - start;
    answerText = "I wasn't able to retrieve any grounded evidence for this deep search across the sub-questions I planned. Please try rephrasing or narrowing the question.";
    emit("token", TokenEvent.parse({ text: answerText }));
  } else {
    const evidenceBySubQ = subQuestions
      .map((sq) => {
        const parts = grounded.filter((g) => g.subQuestion === sq.i);
        if (parts.length === 0) return `${sq.i}. ${sq.question}\n(no grounded evidence found for this sub-question)`;
        return `${sq.i}. ${sq.question}\n${parts.map((p) => `[${p.n}] ${p.text}`).join("\n\n")}`;
      })
      .join("\n\n");

    const userContent = `Original question: ${req.query}\n\nSub-questions researched:\n${evidenceBySubQ}`;

    const stream = anthropic.messages.stream({
      model: LLM_MODEL,
      max_tokens: 2048,
      system: SYNTHESIS_SYSTEM,
      messages: [...(await loadThreadHistory(threadId, userId)), { role: "user", content: userContent }],
      ...({ output_config: { effort: "low" } } as Record<string, unknown>),
    });
    stream.on("text", (delta) => {
      if (!ttftMs) ttftMs = Date.now() - start;
      answerText += delta;
      emit("token", TokenEvent.parse({ text: delta }));
    });
    const msg = await stream.finalMessage();
    inTok += msg.usage?.input_tokens ?? 0;
    outTok += msg.usage?.output_tokens ?? 0;
  }

  // Same honesty rule as the quick loop: a deep run that ran out of budget
  // part-way through its sub-questions must say so in the answer text, not
  // only in the done event's terminated field.
  if (terminated === "cap") {
    const note =
      "\n\n_This deep search is partial: it hit its tool-call or time budget before finishing every sub-question it planned._";
    answerText += note;
    if (!ttftMs) ttftMs = Date.now() - start;
    emit("token", TokenEvent.parse({ text: note }));
  }

  const costUsd = (inTok / 1e6) * 3.0 + (outTok / 1e6) * 15.0 + searchTally.liveCalls * 0.008;
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
        mode: req.mode,
        depth: "deep",
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
      answerId,
      latencyMs: Date.now() - start,
      ttftMs,
      model: LLM_MODEL,
      tokens: { in: inTok, out: outTok },
      costUsd: Number(costUsd.toFixed(6)),
      searchCached: searchTally.allCached,
      terminated,
      depth: "deep",
      subQuestions: subQuestions.length,
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
    latencyMs: Date.now() - start,
    searchCached: searchTally.allCached,
    depth: "deep",
  };
}
