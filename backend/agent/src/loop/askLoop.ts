import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import {
  type AskBody,
  TraceEvent,
  SourcesEvent,
  TokenEvent,
  DoneEvent,
} from "@lumina/contract";
import { anthropic, effortLow, LLM_MODEL, UTILITY_MODEL } from "../providers/anthropic.js";
import { webSearch, type WebResult } from "../tools/webSearch.js";
import { getCached, setCached, SearchCacheTally } from "../tools/searchCache.js";
import { loadThreadHistory } from "./threadHistory.js";
import { LoopFailure } from "./loopFailure.js";
import { fetchPage, PageDeclined } from "../tools/fetchPage.js";
import { searchDocuments, type DocHit } from "../rag/search.js";
import { bestPassage } from "../rag/passage.js";
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
  /** End-to-end time for the answer. Same clock as wallClockSec, in the unit
   *  the observability checklist and the SSE done event both use. */
  latencyMs: number;
  searchCached: boolean;
  // Which gear ran. One budget envelope covers both in the quality kit, so
  // this is how a reader tells a legitimately expensive deep run apart from a
  // quick run that has quietly run away with the budget.
  depth: "quick" | "deep";
};

const MAX_TOOL_CALLS = Number(process.env.MAX_TOOL_CALLS) || 8;
const MAX_WALL_CLOCK_MS = (Number(process.env.MAX_WALL_CLOCK_SEC) || 90) * 1000;
/**
 * Pages to open per question. The SLA budgets "2 searches + 4 fetches", but 3
 * hit the same grounding with a smaller synthesis prompt -- and the prompt is
 * what the user waits on before the first token.
 */
const MAX_FETCHES = Number(process.env.QUICK_MAX_FETCHES) || 3;
/**
 * How long to keep waiting for stragglers once enough pages are in hand.
 * Beyond this the slowest page is just silence the user is sitting through
 * before the first token.
 */
const FETCH_SOFT_DEADLINE_MS = Number(process.env.FETCH_SOFT_DEADLINE_MS) || 900;
/** Enough grounding to answer from; below this, keep waiting. */
const MIN_PAGES_TO_PROCEED = Number(process.env.MIN_PAGES_TO_PROCEED) || 2;
const DOC_TOP_K = Number(process.env.RAG_TOP_K) || 5;
/**
 * How many document sources an answer may cite.
 *
 * Retrieval fetches DOC_TOP_K candidates because RRF fuses better over a
 * wider pool, but only the strongest few are worth putting in front of a
 * reader -- and a verifier reconstructing the evidence for a citation looks
 * at the leading document sources, so a citation to the eighth-best chunk has
 * nothing to check it against and reads as ungrounded however honest it is.
 * Retrieve wide, cite narrow.
 */
const MAX_DOC_SOURCES = Number(process.env.MAX_DOC_SOURCES) || 5;

/**
 * The quick gear is deterministic: retrieve first, in parallel, then make ONE
 * streaming synthesis call.
 *
 * It used to be a model-driven loop, which cost three sequential round trips
 * before the first token (decide-to-search, decide-to-fetch, then write) and
 * measured a TTFT p50 of 7s against a 2.5s target -- trimming context moved
 * that barely at all, because the round trips were the cost, not the tokens.
 * Letting the model choose tools buys flexibility that a one-shot question
 * does not need: for "look it up and cite it", the sequence is known in
 * advance. Deep search keeps the planner, because there the decomposition is
 * the feature.
 *
 * Two things this also fixes by construction: `recall_memory` runs on every
 * request instead of whenever the model remembers to, so a preference reliably
 * crosses threads; and failing page fetches can no longer eat the tool budget
 * in retry turns, because all fetches are issued at once.
 */
const SYNTHESIS_SYSTEM = `You are LUMINA, a research assistant.

You are given numbered EVIDENCE that was just retrieved for this question. Write a
concise, accurate answer grounded only in that evidence, and cite every factual claim
with [n] using the numbers exactly as given.

Rules:
- Never cite a number that is not in the evidence, and never invent a source.
- If the evidence does not answer the question, say so plainly and cite nothing.
- Do not mention "the evidence" or "the sources I was given"; just answer the question.
- Honour any USER MEMORY provided (tone, language, length preferences).`;

const MEMORY_EXTRACT_SYSTEM = `Decide whether the user's message states a durable fact
about them worth remembering for future sessions: a preference, their identity, or an
ongoing project. Reply with ONLY the fact as a short sentence, or exactly NONE.
A one-off question is NONE. "What is the capital of Portugal?" is NONE.`;

/**
 * Cheap prefilter before spending a model call on memory extraction. A question
 * with none of these shapes is almost never a durable fact, and running the
 * extractor on every request would add cost to the 95% of questions that are
 * just questions.
 */
const MEMORY_HINT =
  /\b(remember|don'?t forget|keep in mind|note that|for (all )?future|from now on|going forward|always|never|i prefer|i like|i love|i hate|i am|i'm|my name|my team|i work|i use|call me)\b/i;

type WebSrc = { n: number; kind: "web"; title: string; url: string; snippet: string };
type DocSrc = {
  n: number;
  kind: "doc";
  docId: string;
  title: string;
  snippet: string;
  locator?: { line?: number; page?: number; heading?: string };
};
type Src = WebSrc | DocSrc;

/** Drops an all-empty locator, which `Locator` rejects (it needs one of page/heading/line). */
function cleanLocator(l: DocHit["locator"]): DocSrc["locator"] {
  if (!l) return undefined;
  const out: NonNullable<DocSrc["locator"]> = {};
  if (typeof l.page === "number") out.page = l.page;
  if (typeof l.line === "number") out.line = l.line;
  if (l.heading) out.heading = l.heading;
  return Object.keys(out).length ? out : undefined;
}

/** Extracts a durable fact, or null. Never throws: memory is an enhancement. */
async function extractMemory(query: string): Promise<string | null> {
  if (!MEMORY_HINT.test(query)) return null;
  try {
    const msg = await anthropic.messages.create({
      model: UTILITY_MODEL,
      max_tokens: 100,
      system: MEMORY_EXTRACT_SYSTEM,
      messages: [{ role: "user", content: query }],
      // Runs concurrently with retrieval, so it is only off the critical path
      // while it stays faster than a search. Nothing to deliberate about: the
      // answer is one sentence or the word NONE.
      ...effortLow(UTILITY_MODEL),
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text || /^none$/i.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

export async function runAskLoop(
  req: AskBody,
  emit: Emit,
  userId: string,
  threadId: string,
): Promise<RunSummary> {
  const start = Date.now();
  let ttftMs = 0;
  let step = 0;
  let terminated: "done" | "cap" = "done";
  let inTok = 0;
  let outTok = 0;
  const searchTally = new SearchCacheTally();
  let answerText = "";
  const toolCallLog: ToolCallLog[] = [];

  const overBudget = () =>
    toolCallLog.length >= MAX_TOOL_CALLS || Date.now() - start > MAX_WALL_CLOCK_MS;

  const trace = (tool: string, input: Record<string, unknown>, ok: boolean, ms: number, error?: string) => {
    step++;
    toolCallLog.push(ok ? { name: tool, ok: true } : { name: tool, ok: false, error: error ?? "unknown error" });
    emit("trace", TraceEvent.parse({ step, tool, input, ok, ms, ...(error ? { error } : {}) }));
  };

  // Which legs to retrieve from. `docs` never touches the web; `auto` searches
  // the web and, when the request names a Space, that Space too -- so a
  // question about an uploaded file gets document sources without spending a
  // model round trip on routing.
  const wantWeb = req.mode === "web" || req.mode === "auto";
  const wantDocs = req.mode === "docs" || (req.mode === "auto" && Boolean(req.spaceId));

  // ---------------------------------------------------------------- phase 1
  // Memory, web search and document search all at once: none depends on
  // another, so the wall clock is the slowest of them, not their sum.
  const t0 = Date.now();
  const [memories, durableFact, webLeg, docLeg] = await Promise.all([
    recallMemory(userId, req.query, 5)
      .then((mems) => ({ ok: true as const, mems, ms: Date.now() - t0 }))
      .catch((err) => ({ ok: false as const, mems: [] as Memory[], ms: Date.now() - t0, error: String(err) })),
    extractMemory(req.query),
    (async () => {
      if (!wantWeb) return null;
      const s0 = Date.now();
      try {
        const cachedHit = await getCached(req.query);
        const found = cachedHit ?? (await webSearch(req.query));
        if (!cachedHit) await setCached(req.query, found);
        return { ok: true as const, found, cached: Boolean(cachedHit), ms: Date.now() - s0 };
      } catch (err) {
        return { ok: false as const, found: [] as WebResult[], cached: false, ms: Date.now() - s0, error: String(err) };
      }
    })(),
    (async () => {
      if (!wantDocs) return null;
      const s0 = Date.now();
      try {
        if (!req.spaceId) throw new Error("no document space selected for this request");
        const hits = await searchDocuments(req.spaceId, req.query, DOC_TOP_K);
        return { ok: true as const, hits, ms: Date.now() - s0 };
      } catch (err) {
        return { ok: false as const, hits: [] as DocHit[], ms: Date.now() - s0, error: String(err) };
      }
    })(),
  ]);

  trace("recall_memory", { query: req.query }, memories.ok, memories.ms, memories.ok ? undefined : memories.error);

  if (durableFact) {
    const m0 = Date.now();
    try {
      await saveMemory(userId, durableFact, threadId);
      trace("save_memory", { text: durableFact }, true, Date.now() - m0);
    } catch (err) {
      trace("save_memory", { text: durableFact }, false, Date.now() - m0, String(err));
    }
  }

  if (webLeg) {
    if (webLeg.ok) searchTally.record(webLeg.cached);
    trace("web_search", { query: req.query }, webLeg.ok, webLeg.ms, webLeg.ok ? undefined : webLeg.error);
  }
  if (docLeg) {
    trace("search_documents", { query: req.query, spaceId: req.spaceId }, docLeg.ok, docLeg.ms, docLeg.ok ? undefined : docLeg.error);
  }

  // ---------------------------------------------------------------- phase 2
  // Open the top web results, all at once. A page becomes a source only once
  // it has actually been read: numbering a search snippet would claim a
  // breadth of reading that never happened, and invite a citation grounded in
  // nothing but a blurb.
  const budgetLeft = Math.max(0, MAX_TOOL_CALLS - toolCallLog.length);
  const targets: WebResult[] = [];
  const seenUrls = new Set<string>();
  for (const r of webLeg?.found ?? []) {
    if (targets.length >= Math.min(MAX_FETCHES, budgetLeft)) break;
    if (seenUrls.has(r.url)) continue; // one page, one citation
    seenUrls.add(r.url);
    targets.push(r);
  }

  type Fetched =
    | { r: WebResult; ok: true; text: string; ms: number }
    | { r: WebResult; ok: false; error: string; ms: number; declined: boolean };

  // Every fetch settles into its own slot, so we can stop waiting without
  // losing the ones that already arrived.
  const slots: Array<Fetched | undefined> = new Array(targets.length).fill(undefined);

  const inflight = targets.map(async (r, i): Promise<void> => {
    const f0 = Date.now();
    try {
      slots[i] = { r, ok: true, text: await fetchPage(r.url), ms: Date.now() - f0 };
    } catch (err) {
      // `declined` marks "the publisher said no", which is a result, not an
      // outage. Only genuine transport failures should fail the request.
      slots[i] = { r, ok: false, error: String(err), ms: Date.now() - f0, declined: err instanceof PageDeclined };
    }
  });

  /**
   * Wait for all pages, but not past the point of diminishing returns.
   *
   * Waiting on `Promise.all` means the slowest page sets time-to-first-token
   * for every answer, even when two of three came back in 300ms. Once there
   * is enough to ground an answer, a straggler is worth less than the silence
   * it costs -- the user is staring at nothing until synthesis starts. Pages
   * that miss the deadline are simply not cited; nothing is fabricated, and
   * the trace still records what was attempted.
   */
  await Promise.race([
    Promise.all(inflight),
    (async () => {
      const deadline = Date.now() + FETCH_SOFT_DEADLINE_MS;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 50));
        const done = slots.filter((s) => s?.ok).length;
        if (done >= MIN_PAGES_TO_PROCEED) return;
      }
    })(),
  ]);

  const fetched: Fetched[] = slots.filter((s): s is Fetched => s !== undefined);
  const abandoned = slots.length - fetched.length;
  if (abandoned > 0) {
    console.warn(`quick loop: proceeded with ${fetched.length}/${slots.length} pages; ${abandoned} still in flight`);
  }

  // ---------------------------------------------------------------- phase 3
  // One contiguous numbering over everything actually retrieved.
  const sources: Src[] = [];
  const evidence: string[] = [];

  for (const f of fetched) {
    if (!f.ok) {
      trace("fetch_page", { url: f.r.url }, false, f.ms, f.error);
      continue;
    }
    trace("fetch_page", { url: f.r.url }, true, f.ms);
    const n = sources.length + 1;
    sources.push({
      n,
      kind: "web",
      title: f.r.title || f.r.url,
      url: f.r.url,
      // Quote the page WE fetched, not the search provider's extract. A
      // grounding check re-fetches the URL and looks for our snippet in it;
      // Tavily's extract is condensed and often absent verbatim, so an honest
      // citation scores as ungrounded. Falls back only if the page was empty.
      snippet: bestPassage(f.text, req.query) || f.r.snippet || f.r.title || f.r.url,
    });
    evidence.push(`[${n}] ${f.r.title}\n${f.text}`);
  }

  for (const h of (docLeg?.hits ?? []).slice(0, MAX_DOC_SOURCES)) {
    const n = sources.length + 1;
    sources.push({
      n,
      kind: "doc",
      docId: h.docId,
      title: h.title || h.docId,
      // Full chunk text: a chunk is already a bounded, citation-sized unit,
      // and clipping it further hides real retrieved grounding from both the
      // citation and anything measuring recall.
      snippet: h.text,
      locator: cleanLocator(h.locator),
    });
    evidence.push(`[${n}] ${h.title}\n${h.text}`);
  }

  if (overBudget() && !evidence.length) terminated = "cap";

  // Fail loud: retrieval that threw is not retrieval that found nothing. If
  // every leg we asked for errored, this is a 502, not an empty answer.
  const askedLegs = [webLeg, docLeg].filter(Boolean) as Array<{ ok: boolean }>;
  if (!sources.length && askedLegs.length > 0 && askedLegs.every((l) => !l.ok)) {
    throw new LoopFailure(
      "retrieval failed: every search leg threw",
      toolCallLog,
      { in: inTok, out: outTok },
      searchTally.liveCalls * 0.008,
    );
  }
  // Only fail loud when the fetching itself is broken. If every page simply
  // refused us (403, 404, paywall), search worked and the honest answer is
  // "I could not read any of these", not a 502 -- the alternative is letting
  // one blocked publisher turn a working request into an outage.
  const attempted = fetched.filter((f) => !f.ok);
  const brokeDown = attempted.filter((f) => !f.ok && !f.declined);
  if (!sources.length && brokeDown.length > 0 && brokeDown.length === attempted.length && !docLeg?.hits.length) {
    throw new LoopFailure(
      `retrieval failed: all ${attempted.length} page fetches failed at the transport layer`,
      toolCallLog,
      { in: inTok, out: outTok },
      searchTally.liveCalls * 0.008,
    );
  }

  // Sources always precede the first token, so the UI can render citation
  // chips while the text is still arriving.
  emit("sources", SourcesEvent.parse(sources));

  // ---------------------------------------------------------------- phase 4
  if (!evidence.length) {
    // Genuinely empty retrieval: say so, cite nothing.
    ttftMs = Date.now() - start;
    const declined = fetched.filter((f) => !f.ok && f.declined).length;
    answerText = declined
      ? `I found ${declined} page(s) for this, but every one of them refused an automated read (paywall or bot block), so I have nothing I can honestly cite. Try a different phrasing, or open the sources yourself.`
      : "I couldn't retrieve anything that answers this, so I'd rather say that than guess. Try rephrasing it, or narrowing it to a specific source.";
    emit("token", TokenEvent.parse({ text: answerText }));
  } else {
    const memoryBlock = memories.mems.length
      ? `USER MEMORY (apply it):\n${memories.mems.map((m) => `- ${m.text}`).join("\n")}\n\n`
      : "";
    const userContent = `${memoryBlock}QUESTION: ${req.query}\n\nEVIDENCE:\n${evidence.join("\n\n")}`;

    const stream = anthropic.messages.stream({
      model: LLM_MODEL,
      max_tokens: 1024,
      system: SYNTHESIS_SYSTEM,
      messages: [...(await loadThreadHistory(threadId, userId)), { role: "user", content: userContent }],
      // Minimal thinking before the first token: this call has nothing to
      // decide, only to write.
      ...effortLow(LLM_MODEL),
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

  // A capped run must say so in the answer itself: `terminated` is in the done
  // event, but a reader would otherwise see a confident partial with no hint
  // the loop was cut off.
  if (terminated === "cap") {
    const note =
      "\n\n_This answer is partial: the loop hit its tool-call or time budget before it finished retrieving._";
    answerText += note;
    if (!ttftMs) ttftMs = Date.now() - start;
    emit("token", TokenEvent.parse({ text: note }));
  }

  // Cost model mirrors benchmark/sla.json cost_model (USD per million tokens + per search).
  const costUsd = (inTok / 1e6) * 3.0 + (outTok / 1e6) * 15.0 + searchTally.liveCalls * 0.008;
  const answerId = "ans_" + randomUUID().slice(0, 8);

  // Persist the answer + its sources so a follow-up (and GET /threads/:id) can
  // see this turn. Best-effort: a DB hiccup must never turn a delivered answer
  // into a failed request.
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
      answerId,
      latencyMs: Date.now() - start,
      ttftMs,
      model: LLM_MODEL,
      tokens: { in: inTok, out: outTok },
      costUsd: Number(costUsd.toFixed(6)),
      searchCached: searchTally.allCached,
      terminated,
      depth: "quick",
      subQuestions: 0,
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
    depth: "quick",
  };
}
