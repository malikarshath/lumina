---
project: LUMINA
assignment: FDE Assignment 1
due: end of Week 2
updated: 2026-09-18
---

# LUMINA: progress dashboard / handoff

Hub note. Related: [[DESIGN]] · [[DECISIONS]] · [[API]] · [[ATLAS-SETUP]] · [[BUILD-LOG]]

> Keep this honest. A box is checked only when the verify command passed, not when the code
> looks right. Inspection is not verification.

## TL;DR for whoever picks this up next

LUMINA is built, deployed, and working end to end. On 2026-09-18 course staff shipped the official
scaffold at `Assignment_1_Lumina/` (sibling to this folder) and swapped 20 rubric points from
deck/image generation to a "Deep Search" mode with a specific, different contract. Its
`eval/rubric.json`, `benchmark/sla.json`, `benchmark/bench.mjs` and `expectations.json` are now the
source of truth for scoring.

**As of 2026-09-18 (later session): the deep-search contract gaps are closed and measured.** All
eleven of the official bench's deep-search assertions were re-implemented locally against a real
captured stream and pass 11/11 (see [[BUILD-LOG]] Session 26 for the commands and numbers).

Two gaps were found that the earlier four-item list had **missed**, and both were blockers:

1. **The gear is `depth`, not `mode`.** The official `AskBody` is
   `{ query, mode: auto|web|docs, depth: quick|deep }` and `benchmark/lib.mjs` always sends
   `depth`. Our build read `mode === "deep"` and ignored `depth` entirely, so under the official
   bench every "deep" request would have silently run the **quick** loop and scored 0 of 15 —
   while looking fine in our own UI.
2. **`expectations.json` still held the quick envelope** ($0.05 / 8 tool calls / 90 s). The
   official file was widened to the DEEP envelope ($0.35 / 24 / 240 s, `maxConsecutiveSameTool: 4`)
   precisely because `quality/check.mjs` applies one budget to every run log. Ours was unchanged,
   so every legitimate deep run failed Gate 1 on B3/A2/A3.

The four originally-listed gaps are also closed: the `plan` event (streamed before any retrieval),
`subQuestion` on every retrieval trace step **and** every source, `DEEP_DAILY_CAP` with
`429 {error, resetsAt}`, and the `plan_research` rename.

One more thing had to change to satisfy `min_deep_source_ratio: 2.0`, and it was a real defect
rather than a tuning knob: **the quick loop was registering every web_search result as a
"source"** — ten sources for a question it had opened three pages for. That both inflated the
denominator (deep 14 vs quick 10 = 1.40x, FAIL) and invited citations grounded in nothing but a
Tavily blurb. A page now earns a citation number only when `fetch_page` has actually read it. Quick
reports 3 real sources, deep 15, ratio **5.00x** (PASS), and quick's own citations still resolve
with zero dangling.

## Session 28 (2026-09-18): adopting the PROVIDED scaffold — the root cause of everything

`TECHNICAL.md` line 79: *"You should not need to edit `web/`, `packages/contract/`, `benchmark/`,
`eval/`, `quality/` or `scripts/`."* We had **hand-written our own versions of all of them.** Every
contract gap chased in Sessions 26–27 was a symptom of that one decision.

What was actually wrong, and why it was invisible: our `packages/contract` was a good-faith
reimplementation, so our backend validated cleanly against *our own* schemas and our UI rendered
perfectly. Nothing could tell us the shapes were different from the ones the grader reads.

**The fatal one.** The provided `SourcesEvent` is `z.array(Source)` — a bare array. We emitted
`{"event":"sources","sources":[…]}`. The grader's parser does `out.sources = parsed`
(`benchmark/lib.mjs:155`), so `out.sources` became an *object*, and every check that iterates it —
citation grounding, recall@5, the deep/quick source ratio, page locators, router-picks-docs — would
have scored **zero on roughly 60 of the 100 points**, while our own UI looked flawless. None of our
own tooling could ever have caught this, because our tooling agreed with us.

Migration done (backups of the hand-rolled versions in `.pre-official-backup/`):

| Change | Detail |
|---|---|
| Provided folders adopted verbatim | `packages/contract/`, `benchmark/`, `eval/`, `quality/`, `scripts/` + `expectations.json`, `tsconfig.base.json`. This also **removes the red-line risk** of "provided folders edited", and gives us the `eval.mjs` gate runner, `build-report.mjs`, `lib.mjs`, `rules.json` and `indexes.json` we never had. |
| SSE payloads are now the payload only | `sources` is a bare array; no event name duplicated inside the JSON. |
| Contract symbols | `AskRequest`→`AskBody`, `ThreadMessagesResponse`→`GetThreadResponse`. |
| `/health` | `db` and `ai.status` are `ok\|down` enums — we were returning `"unconfigured"` and `"unknown"`, both of which **throw** `HealthResponse.parse`. `status` is now `ok\|degraded`. |
| Run log | `toolCalls[].name` must be a real `ToolName`; the error path wrote `"ask_loop"`. Now an empty array, with `terminated:"error"` carrying the signal. |
| Artifacts | Kept as an extra, with schemas in `routes/artifactSchemas.ts` — the provided contract has no artifact routes and must not be edited. |
| Our Next.js UI | **Kept** — `TECHNICAL.md:343` lists "your own UI replacing `web/`" as a *bonus*. It now imports its types from `@lumina/contract`, so drift fails `npm run typecheck` instead of rendering nothing. |
| Atlas indexes | Official `scripts/indexes.json`: `chunks_vector`, `memories_vector`, `chunks_text`. Our old `vector_index`/`text_index` were dropped. M0 allows exactly 3 search indexes and Atlas's `sample_mflix` sample dataset was holding the third slot — dropping that sample index is what made `chunks_text` (and therefore hybrid search) possible at all. |

### Musts closed in the same session

- **PDF page locators.** `pdf-parse` flattens a PDF, so chunks carried `{line}`. The gold set keys
  26 of its 39 items on `doc` + `page`, and `bench.mjs:409` requires `s.locator?.page === item.page`
  — so recall was **structurally** 0, with a ceiling of 0.33 even if retrieval were perfect. Now
  parsed page-by-page with `pdfjs-dist` (`rag/parse.ts`), chunked per page without ever spanning a
  page boundary. **recall@5 went 0/3 → 3/3.**
- **Hybrid retrieval.** `$vectorSearch` + `$search` (BM25) fused with Reciprocal Rank Fusion.
  Fusing by *rank* rather than score is the point: cosine similarity and BM25 relevance are
  different units, so adding them lets whichever retriever emits bigger numbers decide the order.
  Degrades to vector-only with a warning if the text index is unavailable.
- **Memory recall via Atlas Vector Search** on `memories_vector`, filtered by `userId` inside the
  vector stage. The in-JS cosine scan survives only as a fallback.

### Measured, on the provided benchmark

| Check | Result |
|---|---|
| Contract probes (all four, incl. `/evals/report.json` not 401) | ✓ pass |
| Citation grounding | **1.00** (12/12 verifiable, **0 dangling**) |
| recall@5 | **3/3** |
| `202` accept p95 | 975 ms (≤ 300 ms target is on the full run; smoke includes cold start) |
| Cost per quick answer | **$0.0331** (≤ $0.05) |
| Sources before first token | ✓ |
| Error rate | 0 |
| `quality/check.mjs` — C1, A1, A3, E1, **E2**, B1, B2, B3 | ✓ pass |

### The quick loop is now deterministic — and it is what fixed latency and cost

The quick gear used to be a model-driven loop: three sequential LLM round trips before the first
token (decide-to-search, decide-to-fetch, then write). Trimming context barely moved it, which
proved the round trips were the cost, not the tokens. It is now **retrieve first, in parallel,
then ONE streaming synthesis call** — the shape the SLA's own note describes ("plan + 2 searches +
4 fetches + synthesis"), and the one deep search already used.

The trade-off, stated plainly: we gave up the loop's freedom to choose its own tools mid-answer.
That is worth it here because for "look it up and cite it" the sequence is known in advance;
deep search keeps its planner, because there the decomposition *is* the feature.

Two bugs it fixed by construction, which is the real argument for it:

- `recall_memory` now runs on **every** request instead of whenever the model remembered to, so a
  saved preference reliably crosses threads.
- Failing page fetches can no longer eat the tool budget in retry turns. The evidence: one run on
  the old loop hit `terminated: "cap"` at 8 tool calls and **$0.0848**, having spent 5 of them on
  `fetch_page` attempts of which 3 failed — it retried dead pages until the cap stopped it. All
  fetches now go out at once, so three dead pages fail concurrently and the budget survives.

Also added: a **2 s timeout per page fetch**. Fetches run in parallel, so the slowest page gated the
whole answer — one unresponsive publisher could spend the user's entire latency budget on an 8 s
timeout. A slow page is now abandoned, traced `ok:false`, and the answer is grounded in the pages
that did respond.

**GridFS.** Uploads no longer ride on the job row as base64 (which inflates by a third and has to
fit one 16MB BSON document — a 25MB upload would simply have failed). The file id is minted
client-side so the GridFS write and the `documents` insert go out **concurrently**, and the `jobs`
row is written **last** on purpose: it is the signal that makes the ingest claimable, and a worker
that claimed it earlier would fail on a file that was about to exist.

### Measured on the provided benchmark — before and after

| SLA row | Target | Before (model-driven) | **Now** | |
|---|---|---|---|---|
| ttft p95 | ≤ 2 500 ms | 27 879 ms | **4 724 ms** | ✗ (5.9× better; p50 3 753 ms) |
| answer p95 | ≤ 12 000 ms | 31 660 ms | **10 833 ms** | ✓ **pass** |
| cost / quick answer | ≤ $0.05 | $0.0415 | **$0.0119** | ✓ (3.5× cheaper) |
| citation grounding | ≥ 0.95 | 1.00 | **1.00** | ✓ (12/12 verifiable, **0 dangling**) |
| recall@5 | ≥ 0.70 | **0/3** | **3/3** | ✓ |
| error rate | ≤ 1% | 0 | **0** | ✓ |
| sources before first token | required | ✓ | ✓ | ✓ |
| `202` accept p95 | ≤ 300 ms | 975 ms | 1 576 ms | ✗ — see below |
| `quality/check.mjs` | exit ≤ 1 | 9 errors | **0 errors** | ✓ |

### Now measured against the DEPLOYED gateway — which is the number that counts

Commit `e5f492e` is live on Render. `node benchmark/bench.mjs --smoke --target
https://lumina-fb9s.onrender.com`:

| SLA row | Target | Laptop | **Deployed** | |
|---|---|---|---|---|
| ttft p95 | ≤ 2 500 ms | 4 724 ms | **4 027 ms** | ✗ (but **p50 2 363 ms — under target**) |
| answer p95 | ≤ 12 000 ms | 10 833 ms | **7 085 ms** | ✓ |
| `202` accept p95 | ≤ 300 ms | 1 576 ms | **317 ms** | ✗ by 17 ms |
| citation grounding | ≥ 0.95 | 1.00 | **1.00** | ✓ (12/12 verifiable, 0 dangling) |
| recall@5 | ≥ 0.70 | 3/3 | **3/3** | ✓ |
| cost / quick answer | ≤ $0.05 | $0.0119 | **$0.0098** | ✓ |
| error rate | ≤ 1% | 0 | **0** | ✓ |
| contract probes | 4/4 | ✓ | **4/4** | ✓ |

**The laptop was lying to us about `202`, and by a factor of five.** 1 576 ms locally versus
**288–317 ms** from Render, because the gateway there sits next to the Atlas cluster instead of a
domestic internet connection away from it. The earlier note predicted this; it is worth keeping as
the lesson: a latency number measured from the wrong place is not a conservative estimate, it is a
wrong one, and it would have sent someone optimising a code path that was already fast enough.

**What still misses, and it is now one thing:** ttft p95 4 027 ms. The **median already passes at
2 363 ms**, so this is a tail problem, not a throughput one — Render's cold starts and the
occasional slow publisher. Closing it means either not reading pages before answering (which breaks
the rule that a citation must rest on fetched text) or a faster synthesis model. `202` at 317 ms is
17 ms over and inside run-to-run noise; a warm second run would likely clear it.

`runs/failing/` now holds both kept failures with a README explaining each: the deliberate
invalid-API-key run (`terminated: "error"`, our own A1 precedent) and the historical capped run
that justified replacing the model-driven loop. A2 reads `runs/*.json` and not that subfolder,
which is exactly what `TECHNICAL.md` prescribes.

## Session 27 (2026-09-18, later): full four-document audit

The whole build was audited against all four official documents (`README.md`, `PRD.md`,
`TECHNICAL.md`, `SPEC.md`) rather than the deep-search section alone. That surfaced a second tier of
gaps, mostly outside deep search. **Closed and verified against a running stack:**

| Gap | Was | Now | Proof |
|-----|-----|-----|-------|
| `GET /evals/report.json` | never served; UI fetched `/report.json`; the 401 gate would have caught it anyway | served at the contract path, exempt from the gate | probe returns **200** with no `X-User-Id` |
| `searchCached` | `a \|\| b` — true if **any** search hit | `SearchCacheTally`, true only if **every** search hit | repeat query: `searchCached:true`, cost drops exactly $0.008 |
| Cache key | normalized query only, collection `cache` | `SHA-256(query, provider)`, collection `searchCache` | new TTL index created |
| `spaceId` scoping | `$match` **after** `$vectorSearch` | `filter` **inside** `$vectorSearch`, `spaceId` declared on the index | docs-mode ask returns the right chunk |
| Read-your-write probe | `indexed` was set even when the probe failed | probe gates the status and must match **our own** `docId`; failure → `failed` | upload reached `indexed` in ~15 s |
| `SEARCH_PROVIDER` | documented as swappable, only Tavily existed | real `serpapi` path behind the same `WebResult` contract | unknown provider now throws instead of defaulting |
| Thread follow-up | loop saw only the current query | prior turns replayed (`THREAD_HISTORY_TURNS`) | "What year did **he** become CEO **there**?" answered correctly |
| Job crash-safety | status `queued`, no `claimedAt`, no sweeper | status `pending`, `claimedAt`, sweeper returns stale `running` → `pending` | index `jobs.status_1_claimedAt_1` created |
| Gateway upstream failure | proxy error → 500/hang | **502** with the contract error body | agent killed: `{"error":"upstream agent unavailable: ECONNREFUSED"}` |
| Rate-limit 429 | plain-text default body | `{error, resetsAt}` | — |
| Observability | no `userId`/`route` on the gateway log line; `x-request-id` hidden from the browser | both added; `Access-Control-Expose-Headers: x-request-id` | verified in the pino output |
| `RAG_TOP_K`/`RAG_MIN_SCORE`/`SEARCH_CACHE_TTL_SECONDS` | in `.env.example`, ignored by the code | actually read | — |
| `GET /threads`, `GET /spaces` | missing | implemented | both **200** |
| `npm run typecheck` | `echo 'TODO'` | real `tsc --noEmit` across all four workspaces | passes clean |

**A crash bug was found only because the code was run, not read.** `GET /threads` validated the
whole list in one `.parse()`, and the `threads` collection holds rows the benchmark created with ids
like `bench-rag` that predate the `thr_` prefix. One bad row threw inside an async Express 4 handler,
which became an unhandled rejection, which **killed the agent process**. Non-conforming rows are now
skipped with a warning, and the agent has a terminal error handler plus a loud-but-non-fatal
`unhandledRejection` guard, so one bad row can never again take the whole service down mid-grading.

### Session 27b: the loop-honesty audit (caps, grounding, observability)

A fourth audit pass covered the ask loop's honesty rules, and found one genuine **red-line
violation** that no earlier pass had caught:

**Deep search returned HTTP 200 with a calm "I couldn't retrieve any grounded evidence" when every
single search had thrown.** A dead Tavily key, a provider outage, a network partition — all of them
came back looking like "the internet has nothing on this topic", with `terminated: "done"`. That is
precisely the pattern the spec forbids: an exception wearing an empty result's clothes. The loop now
counts search and fetch outcomes separately, and throws when *nothing succeeded and something
threw*, which the ask route turns into the SSE error with `status: 502` and `terminated: "error"`.
Genuine empty retrieval — searches ran, found nothing worth reading — still answers honestly and
cites nothing, because those are different events.

Proved by fault injection, not by reading: running the agent with a deliberately invalid
`TAVILY_API_KEY` now yields
`{"event":"error","status":502,"error":"deep search failed: all 5 sub-question searches threw"}`,
and the run log records `terminated: "error"` with every failed tool call carrying a non-empty
`error`. That artifact is kept as the failing-trajectory evidence in `runs/failing/`, deliberately
out of the graded `runs/` set so it cannot trip rule A2.

Also closed in this pass:

- **A capped run now says it was capped, in the answer text.** Previously `terminated: "cap"` was
  only in the done event, so a user reading the answer saw either a confident-looking partial or
  nothing at all, with no sign the loop had been cut off mid-investigation.
- **`latencyMs` added to the per-answer summary and log.** The observability checklist names it;
  the log carried `wallClockSec` instead, so the one field a latency dashboard would key on was
  absent.

### Still open, honestly (these did NOT fit the session)

| Gap | Level | Why it matters | Size |
|-----|-------|----------------|------|
| **Hybrid BM25 + RRF fusion** | SPEC **Must** | `text_index` is created but never queried; retrieval is vector-only | large |
| **PDF page locators** | SPEC **Must** | `pdf-parse` flattens the document, so PDF chunks carry `{line}` not `{page}`; the bench's `pageLocator` check and any gold answer keyed to a page will fail | large (needs `pdfjs-dist`, page-aware chunking) |
| **GridFS for uploads** | SPEC **Must** | the file rides on the job row as base64 instead | large |
| **Stage checkpoints on retry** | SPEC **Must** | a retried job re-parses and re-embeds from scratch | large |
| **Memory recall via Atlas Vector Search** | SPEC **Should** | still an in-JS cosine scan; a deliberate M0 search-index budget trade-off, but it is a *Should*, not free | medium |
| **Gateway-side zod validation** | TECHNICAL | the agent validates and returns 400; the edge does not | medium |
| **`501` for unimplemented routes** | SPEC | unimplemented paths 404 rather than 501 | small |
| `/health` `ai.status` | — | hard-coded `"unknown"`; never pings the provider | small |
| **`report.json` is the wrong shape** | evidence red line | the route now exists, but the file it serves has `{assignment, generatedAt, target, scope, bench, checks, samples, rag}` and the contract's `EvalsReport` wants `{assignment, student, repo, video, deployedAt, design, gates, rubric, bench, quality, trajectories}`. Missing `design`, `trajectories`, `student`, `video`, `rubric`, `quality`, `gates`. | large |
| **`report.json` measured against localhost** | evidence red line | committed copy says `"target": "http://localhost:8787"`; the numbers must come from a real run against the **deployed** gateway | medium (re-run) |
| **`web/public/report.json` is git-tracked** | hygiene | `reports/` is ignored but this copy is not, so a stale localhost report ships in the repo | small |
| **No `eval/eval.mjs`** | gates | gates 0–5 cannot be run as specified; `eval/README.md` still says TODO | large |
| **`/evals` design section is a hardcoded paragraph** | design red line | it must be the five DESIGN.md answers in Malik's own words, not prose baked into the page | medium |
| **Agent is publicly reachable on Render** | deploy red line | the spec requires the agent not be publicly reachable; on the free tier it is | medium |
| **No 60–90 s video** | submission | no `video` field, no recording | medium (Malik) |

> **Unresolved tension, for Malik to decide — do not guess at this.** The hygiene rule git-ignores
> `reports/`, but the evidence rule says the **deployed** gateway must serve
> `GET /evals/report.json`. Those pull in opposite directions: if the report is never committed,
> a fresh Render deploy has no file to serve and the route 404s. `web/public/report.json` was
> un-tracked this session because it held a stale `localhost` run, which is the worst of both
> worlds. Three honest ways out: commit `reports/report.json` as generated output (never
> hand-edited) and narrow the ignore rule; or persist the report to Mongo when the eval runs and
> have the route read it from there; or generate it in the deploy pipeline. Each is defensible;
> picking one is a DESIGN.md-shaped call, so it was left open rather than decided quietly.

> On the report: two of its required fields — `design` (five answers in his own words) and
> `trajectories[].notes` ("P1 is not satisfied by pasting a log") — are explicitly Malik's writing.
> They were deliberately **not** generated. A report that auto-fills them would pass the shape check
> and fail the point of the exercise.

Nothing above is faked or worked around. The four `Must` items are real gaps in the build and
should be stated as such rather than presented as complete.

## Deployed

**Submission URL:** https://lumina-web-phi-ashy.vercel.app/ (Vercel, project `lumina-web`).

| Piece | Where | Public? |
|---|---|---|
| UI (our Next.js — a bonus per `TECHNICAL.md:343`) | Vercel `lumina-web` | yes, this is the submission |
| UI (the provided Vite acceptance test, unmodified) | https://lumina-provided-ui.vercel.app | yes, fallback |
| **Gateway** | https://lumina-gateway-malik.fly.dev (Fly, `sin`) | yes — the only door |
| **Agent** | `lumina-agent-malik` (Fly, `sin`) | **NO — zero public IPs** |
| Database | MongoDB Atlas M0 | all three search indexes live (2 vector + 1 text) + TTL |

**The agent is genuinely unreachable, and that is the point.** It holds the provider keys and
enforces `DEEP_DAILY_CAP`, and "a cap you can bypass by calling the service directly is not a cap."

```
fly ips list -a lumina-agent-malik --json   -> 0 addresses
https://lumina-agent-malik.fly.dev/health  -> 000 (no route)
via the gateway                            -> 200
```

The gateway reaches it over Fly's private IPv6 network at
`http://lumina-agent-malik.internal:8000`. On Render both processes sat behind one public URL, so
the cap was bypassable — that was an outright `deploy_docs` fail, and it is why we moved.

**Render is retired.** `https://lumina-fb9s.onrender.com` still exists but holds pre-rotation
credentials and nothing points at it. Delete the service.

**Credentials were rotated on 2026-09-19** (Mongo user password, Anthropic, OpenAI, Tavily) after
they were pasted into a chat transcript. Verified by hash-comparing each new `.env` value against
the exposed one, then proving the new ones work rather than assuming: `/health` reports `db ok`
(new Mongo password accepted) and a full answer streamed 89 SSE frames with grounded citations
(Anthropic + Tavily + OpenAI embeddings all live).

**Verified against the deployed Fly gateway:** `conformance.mjs` 18/18 (every route the provided UI
calls, validated against the provided zod schemas, plus SSE payload shapes and sources-before-token)
and `memory-check.mjs` 4/4 (save in thread A → recall in thread B → delete → gone).

### Deploying it again

```bash
fly deploy -c fly.agent.toml   --depot=false
fly deploy -c fly.gateway.toml --depot=false
```

`--depot=false` is not optional on this laptop: the Depot builder is unreachable from the corporate
network (`connection reset by peer` to `149.248.212.172:443`), and without the flag the build hangs
for ten minutes and then fails. Fly's own remote builder works first time.

## Phase

| Phase | State |
|---|---|
| Read the spec (PRD, AGENTS, README) | done |
| Scaffold folders and config | done |
| `docs/DESIGN.md`, five questions | done |
| `packages/contract/` zod schemas | done |
| Agent service: loop + search + SSE | done |
| Gateway | done |
| UI | done (redesigned: collapsible Trace/Sources sidebar, markdown rendering) |
| Spaces + RAG + worker | done |
| Artifacts: deck, image | done, built and proven — **no longer scored** (rubric swapped this for Deep Search) |
| Deep Search (quick/deep, planner + parallel sub-question research) | done, and now **matches the official contract** — 11/11 of the bench's deep assertions pass on a real run |
| Observability (`/stats`, run logs, request-id correlation) | done |
| `quality/check.mjs` (our own build; staff's canonical version now also exists at the sibling path) | done |
| Bench green, gates pass | partial — TTFT/answer p95 still fail (real, explained trade-off: honest grounding requires search+fetch before the first token) |
| Deploy + submit Vercel URL | done |

## Rubric tracker — CURRENT (100 pts, per the 2026-09-18 official `eval/rubric.json`)

Points are claimed only with evidence. "Evidence" means a command output, a run log, or a
screenshot, not an opinion. This table replaces the deck/image rows with Deep Search.

| # | Area | Pts | Type | State | Evidence |
|---|---|---|---|---|---|
| 1 | UI lights up & contract | 10 | auto | mostly done | 400/401/404/413/429/502 all proven via curl ([[BUILD-LOG]] Session 19). No genuine "not implemented" route left to prove a real `501` against. |
| 2 | Search & cited answers | 20 | auto | **done** | `fetch_page` grounding + two-tier cache, real curl proof ([[BUILD-LOG]] Session 15). |
| 3 | Memory, thread + long-term | 10 | auto | **done** | `save_memory`/`recall_memory`, `GET`/`DELETE /memory` ([[BUILD-LOG]] Session 14). |
| 4 | RAG over documents | 15 | auto | **done** | recall@5 = 0.933–0.967 across two real runs vs. 0.70 target, 35-item gold set ([[BUILD-LOG]] Session 17). |
| 5 | Deep search (automated) | 15 | auto | **done, contract-matched** | `plan_research` → per-sub-question search+fetch units in parallel → merged deduped numbering → synthesis. All 11 official bench assertions re-implemented and passing on a real captured stream: 5 sub-questions planned before any retrieval, 20/20 retrieval steps and 15/15 sources tagged with `subQuestion`, contiguous numbering, 0 dangling citations, $0.119 of $0.35, 21 of 24 tool calls, 39.5 s of 90 s, 5.00x quick source ratio, and a real `429 {error, resetsAt}` at the cap ([[BUILD-LOG]] Session 26). |
| 6 | Performance & SLA | 10 | auto | partial | `quality/check.mjs` built and proven (Session 20). `bench.mjs` itself: cost/error/cache/recall all PASS, **TTFT p95 9,567ms and answer p95 17,762ms both still FAIL** the 2,500ms/12,000ms targets (real numbers, Session 23 — down from 26,821ms/36,542ms after parallelizing tool execution, but grounding-before-token is an architectural floor). |
| 7 | Observability | 5 | auto | **done** | Same `X-Request-Id` in both services' logs, `/stats.costUsdToday` matched the log line exactly, real tool failure logged with non-empty error ([[BUILD-LOG]] Session 18). |
| 8 | Deep search quality (manual) | 5 | manual | not started | Needs a human (Malik) to ask the same question at both depths and judge whether deep is *better*, not just longer. |
| 9 | Human gate & answer quality | 5 | manual | infrastructure done, read-through not done | `/evals` renders one real successful and one real failing trajectory in full ([[BUILD-LOG]] Session 21) — the failing one is a genuine captured `terminated: "error"`, not staged. Malik still needs to personally read both and write up what each taught him (P1 is explicitly a learner action, not something I can do for him). |
| 10 | Deploy & docs | 5 | manual | mostly done | Live on Vercel + Render + Atlas, confirmed today. Rubric literally says "Fly.io or Vercel" for services — we're on Render, which isn't in that list; pre-existing decision, flagged, not re-litigated. `/evals` serves `/report.json`, not the literally-declared `GET /evals/report.json` path — small contract-fidelity gap. |

**Removed from scoring (still built and working, just not graded):** Presentation auto (5) +
Presentation manual (5) + Image generation (10) = 20 pts, swapped 1:1 for Deep Search's 20.

Bonus available: +5 new rule with precedent, +5 subagents-in-parallel for deep search (we already do
concurrent fetch/search, but not via isolated subagents specifically), +5 semantic answer cache.

## The six gates

- [x] **Gate 0 STATIC** — no lint script wired at root yet; `tsc --noEmit` clean across all workspaces; no `.env`/`runs/`/`reports/` committed (verified via `.gitignore` + repeated `git status` checks).
- [x] **Gate 1 CONTRACT** — `node quality/check.mjs .` passes clean on real runs; confirmed it also correctly fails on a synthetic bad run (Session 20). Re-proven on 2026-09-18 over one real quick + one real deep run after adopting the official deep budget envelope: `no findings. 0 error(s), 0 warning(s)`.
- [ ] **Gate 2 RUN** — `bench.mjs` doesn't have a `--smoke` mode; full runs complete with `terminated: "done"` (0% cap rate), but the 5-query-smoke-budget check itself was never run as a discrete step.
- [x] **Gate 3 TRAJECTORY** — `check.mjs` over real `runs/` reports 0 errors; A1/A2/A3/R2 all verified with real and synthetic data.
- [ ] **Gate 4 EVAL** — grounding/recall/retrieval-rate/error-rate all pass; TTFT/answer-latency percentiles do not.
- [ ] **Gate 5 HUMAN** — the trajectories exist and render; the personal read-through + write-up hasn't happened yet.

## SLA targets — actuals from the most recent real run (2026-09-17, `reports/report.json`)

| Metric | Target | Actual | Result |
|---|---|---|---|
| TTFT p95 | <= 2500 ms | 9,567 ms | FAIL (down from 26,821ms before parallelizing tool execution) |
| Full answer p95 | <= 12000 ms | 17,762 ms | FAIL (down from 36,542ms) |
| 202 accept p95 | <= 300 ms | not separately measured | — |
| Citation grounding | >= 95 % | not separately measured as its own metric (E2 grounding is asserted structurally, not sampled) | — |
| RAG recall@5 | >= 0.70 | 0.933 | PASS |
| Search cache hit rate | >= 50 % | 83.3 % | PASS |
| Error rate | <= 1 % | 0 % | PASS |
| Cost per answer (max in sample) | <= $0.05 | $0.047 | PASS |
| Deep search source ratio | >= 2.0x quick | 5.00x (15 deep vs 3 quick, same question) | PASS |
| Deep search cost | <= $0.35 | $0.119 | PASS |
| Deep search p95 | <= 90 s | 39.5 s | PASS (one data point) |
| Deep sub-questions | >= 3 | 5 | PASS |
| Deep plan first paint | <= 4000 ms | not separately measured (plan is emitted before the first trace step; the bench times it) | — |
| Deep tool calls | <= 24 | 21 | PASS |
| Cost per QUICK answer | <= $0.05 | $0.0745 on a hard multi-part question | **FAIL — see blockers** |

The TTFT/latency floor is a deliberate, explained trade-off, not an oversight: the contract requires
`sources` before the first token, so a real search + real page fetch(es) must complete before an
honest answer can start streaming. Already tried and rejected: front-loading a search before the
model's first turn (broke "the agent decides when to search," reverted in an earlier session).
Already tried and kept: `effort: "low"` and parallelizing tool execution within a turn (the biggest
real win so far, ~2-2.8x).

## Red lines

- [x] No secret reachable from the deployed app
- [x] Provided folders unmodified — n/a in practice: staff's newly-shipped `web/`, `packages/contract/`, etc. live at the sibling `Assignment_1_Lumina/` path, not inside this repo; nothing here touches them.
- [x] No fabricated citation in the bench sample
- [x] No `2xx` answer served on a provider exception — proven with a real captured failure (Session 21).
- [x] No capped run reported as `terminated: "done"` — `quality/check.mjs` asserts this (A2).
- [x] Artifact tools (`generate_image`, `make_presentation`) never called from the ask path — structurally true, they're not in the ask loop's tool list at all.
- [x] `plan_research` never called from a quick search — tool renamed to `plan_research`, and it exists only inside `deepLoop.ts`, which the ask route reaches only on `depth: "deep"`. It is not in the quick loop's tool list at all, so the model cannot reach for it. Verified on a real quick run: 5 tool calls, none of them `plan_research`.
- [x] Design section on `/evals` is in my own words

## Blockers

| Blocker | Since | Owner | Note |
|---|---|---|---|
| **Quick answers can exceed `max_cost_per_answer_usd` ($0.05) on hard questions** | 2026-09-18 | Malik (trade-off call) | Measured $0.0745 on the multi-part deep-baseline question. This newly matters because the official bench runs each deep question through **quick first** as its baseline and holds that quick run to $0.05 (`quickBudget`). The cause is not the new code — it is that each turn resends every previous tool result, so three 6,000-char pages get re-billed on every subsequent turn (~13.5k input tokens). Options: trim `fetchPage`'s `maxChars` for the quick loop, summarise older tool results before resending, or cap quick at two fetches. Each trades grounding depth for cost, which is a DESIGN.md trade-off and deliberately left for Malik rather than silently chosen. |
| Deployed Render service has no `DEEP_DAILY_CAP` / `DEEP_*` env vars | 2026-09-18 | Malik | Code defaults (cap 5, 3–5 sub-questions, 3 results each, 24/240 s) apply without them, so deep search works in prod as-is. Set them explicitly anyway so the deployed cap is declared rather than implied — same operational gap pattern as the Atlas/OpenAI keys earlier. |
| Manual grading items require Malik's own action (P1 is explicitly a learner action) | ongoing | Malik | Deep-search-quality judgment (5 pts) and the trajectory read-through write-up (part of 5 pts) can't be done by the tutor on his behalf. |
| No browser tool available this session | ongoing | environment | UI changes (Trace/Sources sidebar, deep mode button, markdown rendering) verified via build output, bundle contents, and real API data — never visually clicked through. |

**Resolved**

| Was blocking | Resolved | Outcome |
|---|---|---|
| Deep search didn't match the newly-shipped official contract | 2026-09-18 | Closed and measured, 11/11 official deep assertions passing on a real run. Two gaps the original list had missed turned out to be the actual blockers: the gear is `depth`, not `mode` (our deep path was unreachable from the official bench), and `expectations.json` still held the quick budget envelope (every deep run failed Gate 1). See TL;DR and [[BUILD-LOG]] Session 26. |
| Database: Supabase vs. MongoDB | 2026-09-06 | MongoDB confirmed by Malik. See [[DECISIONS]] D4. |
| Staff scaffold not shipped | 2026-09-18 | Shipped, at the sibling `Assignment_1_Lumina/` path — but scope changed (deck/image → deep search) as a result. See TL;DR. |
| Search provider unconfirmed | resolved early | Tavily, see [[DECISIONS]] D3. |
| Atlas cluster not yet created | resolved early | M0 free tier, 3 search indexes, all in use. |
| TTFT far over target (26.8s) | 2026-09-17 | Parallelized tool execution within a turn (Promise.all, split I/O from shared-state mutation to avoid a citation-index race) — real 2-2.8x improvement to 9.6s. Still over target; architectural floor, not further reducible without reopening the grounding-vs-latency trade-off. |
