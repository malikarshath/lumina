---
project: LUMINA
type: build-log
---

# LUMINA build log

Newest entry at the top. One entry per working session. Related: [[PROGRESS]] · [[DECISIONS]] · [[DESIGN]]

Each entry answers three things: what I did, what I proved, what is next. "Proved" means a command
ran and I read its output. If nothing was proved, say so.

---

## 2026-09-17 · Session 21: /evals trajectories — one real success, one real failure

**Did (2-hour push, item 3 of 4)**
- Built `eval/capture-trajectory.mjs`: fires one real ask against a running gateway, records every
  raw SSE event in order (no synthesizing), and merges it into `report.json`'s `trajectories.<phase>`
  field alongside a short "what this taught me" note — without touching `bench.mjs`'s own metrics.
- Captured a genuine failing trajectory rather than staging one: restarted the local agent with
  `LLM_MODEL=claude-does-not-exist-xyz` (never touched the real key or Render's env), asked a normal
  question, and got Anthropic's real `404 not_found_error` back. The SSE stream shows exactly one
  `error` event (`status: 502`), zero tokens, and the run log for that request shows
  `terminated: "error"` with the real message — the provider-exception path (flagged as untested in
  Session 18) is now proven, not just logically argued.
- Added a "Trajectories" section to `web/app/evals/page.tsx`: two cards (green/red), each listing
  every captured event as one line (`trace: tool(input) -> ok/FAILED (Nms)`, `sources: N source(s)`,
  `done: ...`, `error: HTTP 502 — ...`), the query, and the lesson line.

**Proved**
- `npx tsc --noEmit` and `next build` both clean.
- Capture run 1 (real model, real key): events = `[trace, trace, trace, sources, done]` — a real
  `web_search` → `fetch_page` → `fetch_page` sequence.
- Capture run 2 (broken model): events = `[error]` with the actual Anthropic 404 body; `answerText`
  is empty; the matching `runs/<id>.json` shows `terminated: "error"`, `tokens: 0`, `costUsd: 0`.
- `next build` succeeded; served the built app locally and confirmed `/report.json` has
  `trajectories.success` and `trajectories.failure` populated with this real data.
- Could not visually screenshot the rendered page in this session (no browser tool available) — the
  page is a client component that fetches `report.json` after mount, so a `curl` of the static HTML
  shows only the shell, not the hydrated content. Verified instead via clean typecheck/build plus the
  underlying data being correctly shaped; a real browser check is still owed before calling this done.

**Next**
- UI hookup for deck/image artifact buttons (item 4).
- A real browser visual check of the new Trajectories section, once one's available.

---

## 2026-09-17 · Session 20: quality/check.mjs — the CONTRACT and TRAJECTORY gates

**Did (still inside the 2-hour push; terse by design)**
- Staff never shipped `quality/check.mjs` (`quality/README.md` still says "Not yet in the repo").
  Built it per that README's own spec: reads `expectations.json` + every `runs/*.json`, asserts by
  arithmetic only. C1 (budgets positive, eval ratios in 0..1, gold set path exists, no tool both
  required and forbidden), then per run: A1 (a failed tool call carries a non-empty error), A2
  (terminated is a valid value, and a run that hit the tool-call cap is never mislabeled `"done"`),
  A3 (thrash guard — no more than `maxConsecutiveSameTool` identical calls in a row), R2 (no
  forbidden artifact tool anywhere in `toolCalls`), B1/B2/B3 (tokens/wallClockSec/costUsd against
  `expectations.json`'s declared budgets). Exit 0 pass / 1 warnings-only / 2 any error, matching the
  gate contract in PRD §13.

**Proved**
- `node --check quality/check.mjs`: syntax OK.
- Empty `runs/`: `WARN [RUN] no runs/*.json found` → exit 1 (not a false pass, not a crash).
- Real runs: fired 3 real asks locally, `node quality/check.mjs .` → `0 error(s), 0 warning(s)`,
  exit 0.
- Injected a synthetic bad run (`ok:false` with an empty error, 4 consecutive `fetch_page` calls,
  a `generate_image` call, 50,000 tokens, $0.09 cost) and confirmed every rule fires on the real
  file: A1, A3, R2, B1, B3 all reported correctly, exit 2. Deleted the fixture immediately after —
  it was never meant to be a real record.

**Next**
- `/evals` full trajectories (P1, manual) — still needs a deliberate `terminated: "error"` trigger.
- UI hookup for deck/image artifact buttons.

---

## 2026-09-17 · Session 19: contract status codes — 404, 413, threads routes

**Did (2-hour push against the remaining rubric gaps; terse by design)**
- `POST /threads` and `GET /threads/:id` never existed at all -- only `POST /threads/:id/ask` did.
  Built both: create writes a `threads` doc; the ask route now auto-creates one too (upsert), so the
  existing UI flow (which never calls `POST /threads` first) keeps working. `GET /threads/:id`
  reconstructs `{messages: [{role, content, sources, artifacts}]}` from the `answers` collection,
  404s if the thread was never created and never answered anything.
- `GET /spaces/:id/documents` and `POST /spaces/:id/documents` now 404 on an unknown `spaceId`
  instead of silently returning an empty list or accepting an upload into nowhere.
- `POST /spaces/:id/documents` now 413s when multer's 25MB limit is hit -- previously multer passed
  the error to Express's default handler, which returned a bare 500, not the contract's 413.

**Proved**
- `npx tsc --noEmit` clean. Started the agent locally and ran real checks: `GET
  /threads/thr_totally_unknown_xyz` -> 404; `GET`/`POST /spaces/spc_nonexistent/documents` -> 404
  both; a real 26MB upload against a real space -> 413 `{"error":"file too large (25MB limit)"}`; a
  real ask in `thr_statuscheck` followed by `GET /threads/thr_statuscheck` -> 200 with the exact
  `[user, assistant]` message pair, sources included.

**Next**
- `quality/check.mjs` (performance_sla, 10 pts).
- `/evals` full trajectories (P1, manual).
- UI hookup for deck/image artifact buttons.

---

## 2026-09-17 · Session 18: observability — one request id, run logs, /stats

**Did**
- Consolidated each service's ad-hoc `X-Request-Id` handling into `pinoHttp`'s own `genReqId`: the
  gateway mints/reuses the header and now also makes it pino's `req.id`; the agent reads the
  header the proxy forwarded and does the same. One id now greps out the same request in both
  services' JSON logs, instead of being buried inside a nested `req.headers` field.
- Built the run log the PRD has required since §5.1 and never had: `src/observability/runLog.ts`
  writes `runs/<requestId>.json` in the exact declared shape (`tokens`, `wallClockSec`, `costUsd`,
  `terminated`, `toolCalls[{name, ok, error?}]`), anchored to the file's own location (not
  `process.cwd()`) so it resolves to repo-root `runs/` whether started via `start-prod.mjs` or
  `tsx` directly from `backend/agent`. Also inserts a superset doc (adds `ttftMs`, `searchCached`,
  `answerId`) into a durable `runs` Mongo collection, since Render's disk doesn't survive a
  redeploy — `scripts/export-runs.mjs` (wired to `npm run export:runs`, previously a TODO stub)
  dumps that collection back to local files for grading against a live deployment.
- `askLoop.ts` now collects a `toolCallLog` (same `{name, ok, error?}` as each `trace` event) and
  returns a `RunSummary`; `ask.ts` writes the run log on both the success path (`req.log.info` one
  line with the full summary, tagged `answer_completed`) and the failure path (`terminated: "error"`,
  which never had *any* persisted record before this — a provider exception used to only reach the
  client as an SSE `error` event and vanish from every log).
- Built `GET /stats` (`src/routes/stats.ts`): every number — `requests`, `answers`,
  `searchCacheHitRatePct`, `ttftP95Ms`, `costUsdToday`, `imagesToday` — is computed straight from
  that same `runs` collection, so it reconciles with the agent's own log by construction, not luck.

**Proved**
- `npx tsc --noEmit` clean in both `backend/agent` and `backend/gateway`; `npm run build:backend`
  clean.
- Started agent + gateway locally against the real Atlas cluster. Sent `POST /threads/thr_obs/ask`
  through the gateway with an explicit `X-Request-Id: obs-test-<ts>`: `grep`'d that exact string in
  both `/tmp/lumina-gateway.log` and `/tmp/lumina-agent.log` — both show `"req":{"id":"obs-test-<ts>"...}`,
  same id, plus the agent's log carries a full `"event":"answer_completed"` line with tokens/cost/
  terminated. The written `runs/obs-test-<ts>.json` matched PRD 13's example shape exactly.
  `GET /stats` afterward showed `costUsdToday: 0.064672` and `answers: 1`, matching the log line's
  `costUsd: 0.064672` exactly (0% drift, well inside the 1% bar).
  Triggered a real tool failure cheaply (no API-key tampering needed): `mode: "docs"` with no
  `spaceId` → `search_documents` throws inside the loop's own try/catch → the SSE `trace` event and
  the written run log both show `"ok": false, "error": "Error: no document space selected for this
  request"` — a genuine non-empty error in `runs/`, not a placeholder.

**Learned**
- The provider-exception path (`terminated: "error"`) was never runtime-tested this session — it
  needs an actual Anthropic outage or an invalid key to trigger for real, and deliberately breaking
  a live key mid-session was too disruptive to justify just for this proof. Logically verified (the
  `catch` block in `ask.ts` now calls `writeRunLog` with `terminated: "error"` and a non-empty
  error), but not run. Worth doing once, deliberately, when building the failing-trajectory example
  `/evals` needs (P1, still open).
- A metric "reconciling" with a log is trivial to guarantee by construction (same collection, same
  write) — the harder, more honest version of this check is making sure nothing that happens to a
  real request skips writing that record, which is why the run log is now written on *both* the
  success and the error path, not just success.

**Next**
- `/evals` full trajectories (P1, 5 pts manual) — now has a real ingredient it didn't before: a true
  `terminated: "error"` run log, once one is deliberately produced.
- Remaining contract status codes: 404/413/501.
- `quality/check.mjs` itself (performance_sla, 10 pts) — `runs/` now has real content for it to read.
- UI hookup for "Make a deck" / "generate image" buttons in `web/`.

---

## 2026-09-16 · Session 17: RAG gold-set eval — recall@5 by arithmetic

**Did**
- Staff never shipped `eval/gold/rag_gold.jsonl` or `eval/gold/corpus/` (confirmed again against
  `eval/README.md`, still marked "TODO, staff-provided" — same gap noted back in Session 1). Per PRD
  §15 that makes it mine to build. Wrote a 5-document corpus (`raft.md`, `photosynthesis.md`,
  `dewey.md`, `westphalia.md`, `public-key-crypto.md`), five distinct, non-overlapping factual
  topics, and 35 gold Q/A pairs in `eval/gold/rag_gold.jsonl` — each with an `expectedKeyphrase`
  copied verbatim from the source doc, so a hit can be checked by normalized substring match, no
  LLM judge, matching `expectations.json`'s already-declared `eval.minRecallAt5: 0.70` and
  `goldSetPath`.
  Wired the measurement into `benchmark/bench.mjs` (the workload was already declared for this:
  `sla.json`'s `workload.doc_queries_from_gold: 30`) — it creates a fresh Space, uploads the corpus
  through the real `POST /spaces/{id}/documents` path, polls to `indexed`, then asks each gold
  question in `mode: "docs"` and checks the returned `sources` snippets for the expected keyphrase.
  Added a `RAG recall@5` row to the SLA checks table and a `rag: {n, recallAt5, samples}` block to
  `report.json`, same shape discipline as everything else `bench.mjs` writes.

**Proved**
- First real run measured `recallAt5: 0.233` — far below 0.70. Rather than accept a bad number, dug
  in with a debug Space + a direct `curl` on the worst-missed question ("How many main classes does
  the Dewey Decimal system divide knowledge into?"): the `sources` event showed the *correct* chunk
  was retrieved (line 1 of `dewey.md`), but its `snippet` was cut off mid-sentence, right before the
  answer, because `askLoop.ts`'s `search_documents` handler was truncating every doc snippet to 300
  characters (`hcap.text.slice(0, 300)`). That was hiding real, correctly-retrieved grounding from
  the model's own citations too, not just from this eval — a genuine product bug the eval exposed,
  not a metric to game. Fixed it to return the full chunk (already bounded to ~1000 chars by
  `chunkText`), no arbitrary second truncation.
- Re-ran: `SKIP_WEB=true node benchmark/bench.mjs` (added the `SKIP_WEB` flag so RAG-only iteration
  doesn't have to pay for a full web pass every time) → 35/35 hits, `recallAt5: 1`.
  Then the full real run, `node benchmark/bench.mjs` against the local gateway+agent+Atlas stack →
  `recallAt5: 0.967` (29/30, sampled per `sla.json`'s declared `doc_queries_from_gold: 30`) — real
  PASS against the 0.70 gate, one miss (`raft-1`) attributable to normal run-to-run variance in which
  chunk the model's own search phrasing surfaces, not a systemic failure.
- Same full run surfaced an honest, unrelated finding worth recording rather than hiding: one cold-pass
  web query ("What is Retrieval-Augmented Generation?", 11,124 input tokens) cost $0.0765, over the
  $0.05 cap, while `avgCostUsd` for the run was $0.034 — `bench.mjs`'s existing check compares the
  *max* single-answer cost to the cap, which is stricter than PRD §9's stated "mean" cost target.
  Pre-existing design choice from an earlier session, not touched today; flagged here, not fixed,
  since it's out of this session's scope.

**Learned**
- A failing number is a lead, not a verdict — 0.233 turned out to be a display-layer bug (snippet
  truncation), not a retrieval-quality problem. Same discipline as the earlier TTFT investigation:
  confirm the mechanism with a direct, minimal repro (one debug Space, one `curl`) before either
  accepting or dismissing a benchmark result.
- `sla.json`'s `workload` section had already declared exactly how this eval should be shaped
  (`doc_queries_from_gold: 30`) well before I got to RAG — worth reading `workload` fully before
  building a benchmark extension, not just `sla`.

**Next**
- `/stats` endpoint + per-answer run logs (`runs/<requestId>.json`) + `quality/check.mjs` — 15 pts
  combined across observability and performance_sla.
- Remaining contract status codes: 404/413/501.
- `/evals` needs to render one full successful and one full failing trajectory (human_gate item).
- UI hookup for "Make a deck" / "generate image" buttons in `web/` (backend from Session 16 is done;
  the button click isn't).

---

## 2026-09-16 · Session 16: artifacts — decks and images, off the ask path

**Did**
- Closed a gap the artifacts feature exposed: nothing persisted an answer's text + sources after
  streaming, so `POST /artifacts` had nothing to build a deck from. Added a best-effort write to a
  new `answers` collection at the end of `runAskLoop` (never lets a DB hiccup fail a good answer —
  same "best-effort" pattern as `searchCache`).
- Built the artifacts pipeline: `src/artifacts/outline.ts` (one Anthropic call turns an answer + its
  numbered sources into a 6–10 slide JSON outline; every citation number is re-checked against the
  real source list before it can reach a slide — a hallucinated `[n]` is filtered out, not trusted),
  `src/artifacts/deck.ts` (renders the outline to a real `.pptx` via `pptxgenjs`, always appending a
  final Sources slide), `src/artifacts/image.ts` (`gpt-image-1`, or a 1×1 placeholder PNG when
  `DRY_RUN=true`).
- Added `src/db/gridfs.ts`: rendered files live in GridFS, in the same Atlas cluster as everything
  else (per DECISIONS — no S3, no second store).
- Added `src/routes/artifacts.ts`: `POST /artifacts`, `GET /artifacts/:id`, `GET /artifacts/:id/file`.
  Image requests reserve today's cap slot atomically (`findOneAndUpdate` on an `imageUsage` row)
  *before* any provider spend, so the `(IMAGE_DAILY_CAP+1)`th request 429s even mid-burst.
- Wired both artifact kinds into the existing jobs worker (`make_presentation`, `generate_image`) —
  new job kinds in the same `queued → running → done|failed` loop `ingest_document` already uses.
  A dead job now also flips its artifact to `status: "failed"` with the error, not just the document
  path that existed before.
- Confirmed by re-reading `askLoop.ts`'s `tools` array that `make_presentation`/`generate_image` were
  never exposed to the loop at all (R2 red line) — no code change needed there, just verification.

**Proved**
- `npx tsc --noEmit` in `backend/agent` and `npm run build:backend` at the root: clean, after fixing
  one real bug — `pptxgenjs`'s UMD `.d.ts` resolves to the whole module namespace instead of the
  default class under `moduleResolution: NodeNext` ("has no construct signatures"); worked around
  with `createRequire` + an explicit constructor cast, same category of fix as the earlier
  `pino-http` default-import issue.
- Ran the agent service locally against the real Atlas cluster and Anthropic/OpenAI keys:
  - `POST /threads/thr_test1/ask` → real streamed answer about MCP, `done` event with 5 real sources.
  - `POST /artifacts {kind:"deck", answerId:"ans_4ba036eb"}` → `202` in the sub-300ms budget.
  - Polled `GET /artifacts/art_6bad5d52` → `ready` after one poll, outline with 10 slides, citations
    only referencing real source numbers 1–5.
  - Downloaded `GET /artifacts/art_6bad5d52/file` → a genuine OOXML zip (`file` confirms it, `zipfile`
    confirms 10 `ppt/slides/slideN.xml` parts + `[Content_Types].xml`); the true last slide
    (numeric-sorted, not lexical — caught my own test-script bug) is a real "Sources" slide listing
    all 5 cited URLs.
  - Fired 3 `POST /artifacts {kind:"image"}` requests with `IMAGE_DAILY_CAP=2`: requests 1–2 → `202`,
    request 3 → `429 {"error":"daily image cap reached","resetsAt":"2026-09-17T00:00:00.000Z"}`.
  - With `DRY_RUN=true`: the accepted image artifacts reached `ready` with
    `{"model":"gpt-image-1","costUsd":0,"promptUsed":"..."}` and the downloaded file is a real
    (1×1) PNG — the whole 202→ready→file flow is provable without spending money.

**Learned**
- The rubric's automated checks for `presentation_auto` and `image_generation` (15 pts combined)
  are all reachable by direct HTTP proof, no UI needed — worth proving via curl before ever touching
  `web/`, same lesson as the earlier grounding work.
- A `require()` return value is only `any` in TypeScript when nothing on `NodeRequire` narrows it —
  a package's own ambient `.d.ts` can still leak through and needs an explicit cast, not just
  `createRequire` on its own.

**Next**
- RAG gold-set eval (`eval/gold/rag_gold.jsonl` + `eval.mjs` computing `recallAt5 >= 0.70`) — 15 pts,
  RAG itself already works, this is just proving `recallAt5` by arithmetic.
- `/stats` endpoint + per-answer run logs (`runs/<requestId>.json`) + `quality/check.mjs` — 15 pts
  combined across observability and performance_sla, and pairs naturally with the pino logging
  already in place.
- Remaining contract status codes: 404/413/501 (413 already partially covered by multer's file-size
  limit but not yet contract-shaped).
- `/evals` still needs to render one full successful and one full failing trajectory, plus the deck
  UI/image UI hookup in `web/` (Scenario D) if time allows — backend is done; the button click isn't.

---

## 2026-09-16 · Session 15: fetch_page + search cache (grounding polish, rubric-driven)

**Did**
- Read eval/rubric.json to prioritize by points. Targeted "Search & cited answers" (20 pts).
- tools/searchCache.ts: two-tier cache (in-process LRU + Mongo `cache` w/ TTL index), best-effort, guarded
  by isDbConfigured. Wired into web_search: hit -> searchCached=true, no Tavily call, no cost; done.searchCached real.
- tools/fetchPage.ts: fetch a URL, strip HTML to text (no dep), 8s timeout. Added fetch_page tool (web/auto).
  web_search tool-result now returns TITLES + URLs only (no snippet content) so the model MUST fetch_page the
  results it cites -> grounding in the real page, not snippets. Strengthened SYSTEM to mandate retrieve-before-answer.
- bench.mjs: cold + warm passes; cacheHitRatePct metric + SLA check (min_search_cache_hit_rate_pct); exits
  non-zero if any gate fails.

**Proved (local + deployed)**
- Trace now shows web_search -> fetch_page (e.g. fetched en.wikipedia.org/wiki/Mount_Fuji); answer grounded in it.
- Repeat query -> searchCached:true, search ms:0. Deployed cold+warm bench: cache hit 66.7% PASS (>=50),
  cost $0.048 PASS (close), errors 0% PASS; TTFT p95 11.4s / answer 19.5s FAIL (honest cost of forced fetch).
- Pushed 7be25fb, f3270af, 25d4b11; /evals refreshed.

**Trade-off logged:** forcing search+fetch on every web query = real grounding (red line + 20 pts) but worse
latency gates (10 pts). Chose grounding. TTFT ≤2.5s remains unachievable with a live search+fetch before the
first token — documented, not gamed.

**Next (remaining rubric gaps):** artifacts (POST /artifacts deck+image, 20 pts) — needs pptx + gpt-image-1 +
IMAGE_DAILY_CAP + DRY_RUN; /stats + per-answer run logs + quality/check.mjs (observability 5 + perf 10);
status codes 404/413/501 (contract 10); eval/gold rag_gold.jsonl + eval.mjs recallAt5 (part of RAG 15);
/evals full success+failing trajectories + design 5-questions (manual 10). fetch_page page-size tuning for cost headroom.

---

## 2026-09-16 · Session 14: docs UI + long-term memory

**Did**
- UI: mode toggle (auto/web/docs), document upload + space panel (localStorage spaceId, poll to indexed),
  askStream now sends spaceId. web/lib/api.ts (createSpace/uploadDoc/listDocs). Verified deployed /health
  db:ok after Malik set Render env (OPENAI/MONGODB/VECTOR_BACKEND) -> RAG live in prod.
- Memory: rag/memory.ts (saveMemory/recallMemory/listMemories/deleteMemory) using in-JS cosine over stored
  embeddings (M0 caps Atlas Search indexes at ~3, spent on chunks; per-user memory sets are small).
  Added recall_memory + save_memory tools (always active, all modes) + userId threaded into runAskLoop.
  routes/memory.ts (GET /memory, DELETE /memory/:id). formatSources helper.

**Proved**
- Local: "remember my favorite language is Rust" -> save_memory trace + stored; GET /memory lists it;
  NEW thread "what's my favorite language?" -> recall_memory -> "Your favorite programming language is Rust."
  Cross-session memory works. Pushed cc7d08d (+ docs UI be48b66).

**Next**
- UI polish for memory (view/delete) if wanted. Remaining/deferred: BM25 hybrid, GridFS large files,
  Mongo collection schemas in the contract package, artifacts (decks/images), fetch_page, own-words DESIGN.md.

---

## 2026-09-16 · Session 13: document RAG works end to end

**Did**
- OpenAI credits added; verified embeddings (text-embedding-3-small, 1536 dims). Deps: openai, multer, pdf-parse.
- providers/openai.ts (embed), rag/chunk.ts (char-window + line locator), rag/search.ts ($vectorSearch on
  chunks scoped by spaceId), worker/worker.ts (poll jobs, claim atomically, parse->chunk->embed->store->
  read-your-write probe->indexed, retry up to 3), routes/spaces.ts (POST /spaces, POST upload multipart ->202
  ->enqueue job, GET documents), pdf-parse.d.ts ambient types.
- askLoop: added search_documents tool + doc-source handling (broadened sources to web|doc union); mode-based
  tool routing (web->web_search, docs->search_documents, auto->both). index.ts mounts spacesRouter + starts
  the worker (guarded by isDbConfigured).

**Proved**
- Full local run: created space, uploaded zephyr.txt (fictional facts), worker indexed it (status pending->
  indexed, pct 100, probe passed). Asked a docs question (mode:docs) -> trace search_documents -> doc source
  (locator line:1) -> answer grounded ENTIRELY in the file ("Dr. Aria Chen ... childhood cat Zephyr [1]").
  First attempt used web_search (mode not enforced) -> fixed with mode-based tool routing; re-test correct.
- Pushed d13cd14.

**Next**
- Set Render env for deployed RAG: OPENAI_API_KEY, MONGODB_URI, MONGODB_DB=lumina, VECTOR_BACKEND=atlas-vector-search.
- Wire doc ingestion + space picker into the Next.js UI. Then memory (recall/save), BM25 hybrid, GridFS for
  large files, Mongo collection schemas in the contract, artifacts (decks/images), own-words DESIGN.md read-through.

---

## 2026-09-16 · Session 12: MongoDB Atlas wired — collections + indexes created

**Did**
- Malik provisioned an Atlas M0 cluster (user malikarshath_db_user, Network Access 0.0.0.0/0),
  pasted MONGODB_URI into .env (MONGODB_DB=lumina). Debugged auth: username was left as the
  `<db_username>` placeholder -> "bad auth"; fixed to the real user.
- Added `mongodb` driver to the agent. Wrote `scripts/create-indexes.mjs`
  (run: `node --env-file=.env scripts/create-indexes.mjs`).

**Proved**
- Script connected (ping ok) and created 6 collections (threads, memories, documents, chunks, jobs, cache),
  standard indexes, a cache TTL index (expiresAt, expireAfterSeconds:0 — the search cache), and two Atlas
  Search indexes on chunks: vector_index (vectorSearch, 1536-dim cosine) + text_index (BM25). Pushed 79eca7a.

**Next**
- Set MONGODB_URI (+ MONGODB_DB, VECTOR_BACKEND=atlas-vector-search) in Render env for the deployed backend.
- Build RAG: db connection module in the agent; /health reports db "ok"; document ingestion (POST /spaces,
  POST upload -> 202 -> jobs worker: parse -> chunk -> embed (OpenAI) -> store -> read-your-write probe ->
  indexed); search_documents tool (vector + BM25 hybrid) added to the loop; memory recall/save.

---

## 2026-09-16 · Session 11: latency tuning — effort:low (3/4 SLA gates pass)

**Did**
- Added `output_config: { effort: "low" }` to the messages.stream call (passed via spread cast since
  SDK 0.68 doesn't type output_config yet; the API honors it). Minimal thinking before first token,
  keeps tool-calling reliable (vs disabling thinking).

**Proved**
- Deployed re-benchmark (Render redeploy confirmed via probe: cost $0.0206, out 132 tok):
  TTFT p95 6952->3329ms (-52%), answer p95 15674->9166ms (now PASS), cost $0.046->$0.028, errors 0%.
  Now 3/4 gates PASS (only TTFT fails, 3329 vs 2500 — the ~2s web search before first token is the gap).
- Pushed askLoop change (4b654f9) + refreshed report.json (b6da3a7); Vercel refreshes /evals.

**TTFT follow-up (same session):** tried front-loading one web search before the model turn to cut a
round-trip; measured TTFT p95 ~3.2s — still over 2500. Concluded TTFT ≤2.5s is an architectural floor
for grounded answers: the first token cannot precede the ~2s web search without emitting ungrounded
text (violates grounded-or-nothing + evidence-over-vibes). Chose Option B: REVERTED the front-load to
preserve the agentic "model decides to search" design; TTFT is the same either way. Kept effort:low.
Deployed state unchanged (still 4b654f9 agent-decides+effort:low; /evals accurate: 3/4 gates pass,
TTFT ~3.3s documented honestly as a search-latency limit).

**Next**
- Atlas M0 being provisioned. Then create-indexes.mjs (vector + text), docs/RAG (search_documents),
  Mongo collection schemas, memory (recall/save), search cache (also the cache-hit-rate gate), fetch_page.

---

## 2026-09-16 · Session 10: /evals page + real benchmark (deployed)

**Did**
- Wired real metrics into the done event: sum msg.usage input/output tokens across turns; costUsd from
  the sla.json cost model (in 3.0 + out 15.0 per MTok + 0.008/search). tokens/costUsd now real.
- `benchmark/bench.mjs`: fires 6 web queries at a target gateway (TARGET env or sla.json), parses SSE,
  records ttft/latency/cost/terminated/errors, aggregates p95s, compares to sla gates, writes
  reports/report.json + web/public/report.json, prints PASS/FAIL.
- `web/app/evals/page.tsx`: client page fetches /report.json, renders design summary + SLA checks table
  (PASS/FAIL badges) + per-query samples. Honest scope note (web slice; docs/RAG not included).

**Proved**
- Pushed to GitHub (Malik set up a PAT in macOS keychain: repo scope / Contents:RW). Render auto-redeployed;
  probe of deployed /ask returned real costUsd 0.018908, tokens in2836/out160.
- Ran bench against DEPLOYED backend (https://lumina-fb9s.onrender.com): cost PASS (max $0.046 <= 0.05),
  error rate PASS (0%). TTFT p95 ~6952ms and answer p95 ~15674ms FAIL vs 2500/12000 — honest (search before
  first token + Sonnet adaptive thinking). Committed+pushed report.json (d2b230c); Vercel redeploys /evals.

**Next**
- Verify deployed /evals renders (need Vercel URL). Then TTFT/latency tuning (effort:low or disable thinking,
  snippet-first), fetch_page, search cache, real searchCached, docs/RAG + Atlas.

---

## 2026-09-15 · Session 9: deploy prep — production build + runbook

**Did**
- Made the backend production-ready: gateway reads `process.env.PORT` (host-injected) with GATEWAY_PORT
  fallback; `scripts/start-prod.mjs` runs agent (:8000) + gateway (:$PORT) in one process; root scripts
  `build:backend` and `start:prod`.
- Wrote `docs/DEPLOY.md`: Vercel (web) + Render (combined backend) runbook, env var list, CORS loop.
- `git init` inside Lumina/ + first commit (82 files; verified .env, node_modules, dist, .next all excluded).

**Proved**
- All four workspaces `build` clean for production (tsc x3 + next build).
- Ran the combined prod launcher on PORT=8080: /health 200 and full ask stream worked; x-request-id
  propagated across gateway->agent. Deployable.

**Handoff**
- Malik pushed the repo from a different system and will run Render + Vercel from there. Reminded him the
  pushed copy must include start-prod.mjs, root build:backend/start:prod scripts, and the gateway PORT fix.

**Next**
- Deploy backend to Render, UI to Vercel, close CORS loop; verify the live URL streams.
- Then /evals page + bench.mjs/check.mjs (report.json), real done metrics, fetch_page, cache, docs/RAG (Atlas).

**Update (same day): DEPLOYED + VERIFIED LIVE.** Backend on Render (https://lumina-fb9s.onrender.com),
UI on Vercel, CORS_ORIGIN set. Tutor verified from outside: GET /health -> 200 (model claude-sonnet-5,
searchProvider tavily; vectorStore "unconfigured" since VECTOR_BACKEND unset — fine, no RAG yet).
POST /ask on prod streamed a real cited answer (Tavily search 2720ms -> Wikipedia source -> tokens).
401 without X-User-Id confirmed in prod. The deployed URL requirement is MET.
Pending: confirm Vercel UI in browser; build the graded /evals page.

**Did**
- Scaffolded `web/` (Next.js 14 App Router + Tailwind 3, no create-next-app): package.json, next.config.mjs,
  tsconfig, postcss/tailwind config, app/globals.css, app/layout.tsx.
- `web/lib/askStream.ts`: browser SSE reader — POST fetch, read res.body stream, buffer partial frames,
  split on blank line, parse event:/data:, dispatch onTrace/onSources/onToken/onDone/onError.
- `web/app/page.tsx`: client search UI — input, streams answer into state, renders trace, sources list, errors.
  NEXT_PUBLIC_GATEWAY_URL (default http://localhost:8787), USER_ID header "malik".

**Proved**
- npm install (web) ok. All three services up (agent:8000, gateway:8787, web:3000).
- curl localhost:3000 -> 200, title LUMINA, page compiles.
- **Malik confirmed in the browser: query -> web search (~1937ms) -> streamed answer with sources.**
  Full stack works end to end: UI -> gateway -> agent -> Claude+Tavily. CORS ok (gateway allows :3000).

**Next (to submittable)**
- /evals page (graded, must prove itself) — needs bench.mjs + check.mjs producing report.json (not built yet).
- Deploy: UI to Vercel + backend (gateway+agent) to a host (Fly per PRD); set NEXT_PUBLIC_GATEWAY_URL + AGENT_URL.
- Then real done metrics (tokens/costUsd), fetch_page, search cache, docs/RAG (Atlas), TTFT tuning.

---

## 2026-09-15 · Session 7: gateway live — full backend works end to end

**Did**
- Built `backend/gateway/` (Node+Express+TS, :8787): package.json (cors, express-rate-limit,
  http-proxy-middleware, pino-http, dotenv), tsconfig, loadEnv.ts (root .env), index.ts.
- index.ts: CORS(origin=CORS_ORIGIN), pino-http, X-Request-Id (reuse-or-mint + echo), rate limit
  (60/min keyed by X-User-Id, IP fallback), identity gate (401 without X-User-Id except /health),
  then createProxyMiddleware(target=AGENT_URL) forwarding everything. Deliberately NO express.json()
  so the POST body streams intact; SSE passes straight through. Agent still validates the contract.

**Proved (both services up, curl through :8787)**
- GET /health -> 200 (no auth), contract-shaped JSON from the agent.
- POST /threads/t1/ask without X-User-Id -> 401 (stopped at gateway, never hit agent).
- POST with X-User-Id: real stream trace->sources(real)->tokens (Linus Torvalds answer, cited).
- Gateway logs show x-request-id, ratelimit-* headers, CORS, content-type text/event-stream.

**Architecture now running:** Browser -> Gateway :8787 (auth/rate-limit/request-id/proxy) ->
Agent :8000 (loop/tools/LLM). The DESIGN.md two-layer split is real code.

**Next**
- Next.js UI in web/ + deploy to Vercel + the /evals page (graded). Then real done metrics
  (tokens/costUsd from stream usage), fetch_page, search cache, docs/RAG (needs Atlas M0).
- Note: gateway-side contract validation is currently deferred to the agent (proxy streams body).

---

## 2026-09-15 · Session 6: real ask loop built (Anthropic + Tavily), blocked on API key

**Did**
- Consulted the claude-api skill (TS SDK, model claude-sonnet-5, manual streaming tool-use loop pattern).
- Added deps `@anthropic-ai/sdk` (0.68.0) + `dotenv`.
- `src/loadEnv.ts`: loads the repo-root `.env` before any client is constructed (imported first in index.ts).
- `src/providers/anthropic.ts`: `new Anthropic()` client + `LLM_MODEL` from env.
- `src/tools/webSearch.ts`: `tavilySearch()` — POST api.tavily.com/search, throws on non-200 (fail loud).
- Rewrote `src/loop/askLoop.ts` as the REAL agentic loop: `anthropic.messages.stream` per turn,
  `stream.on("text")` -> token events, `finalMessage()` -> inspect stop_reason, execute web_search,
  emit trace per tool call, accumulate globally-numbered sources, emit sources before first token,
  enforce MAX_TOOL_CALLS/MAX_WALL_CLOCK (terminated "cap"), fail-loud on tool errors. done event with metrics.

**Proved**
- typecheck green.
- End-to-end run: request validated, loop ran, called Anthropic, got 401, and returned a clean SSE
  `error` event (status 502) — fail-loud verified (no fake answer). Pipeline works.
- Isolated the 401 with a DIRECT curl to api.anthropic.com (app bypassed): same `API key is invalid.`
  -> confirmed the key value is bad at the source, not our code. Key format is clean (sk-ant, 109 chars,
  no whitespace/CR/quotes) so it's a wrong/rotated key or an account without billing.

**Blocker (RESOLVED same session)**
- Anthropic key was invalid (wrong/rotated). Malik created a NEW workspace + key and added credit.
  Direct curl to api.anthropic.com then succeeded (108-char key), and the full LUMINA query streamed
  a REAL cited answer: trace(web_search 3.6s) -> sources(real Tavily result: Google Cloud MCP page) ->
  tokens(grounded answer with [1] matching source n:1) -> done(terminated "done", model claude-sonnet-5).
  The web-search vertical slice works end to end.

**Known gap to tune later**
- ttftMs ~7027ms vs SLA 2500ms — web_search (~3.6s) runs before the first token. Optimize later
  (search depth, thinking/effort tuning, cache). tokens/costUsd/searchCached in done still TODO stubs.

**Next**
- Gateway (:8787, no keys): X-User-Id -> 401, rate-limit, forward to agent, SSE pass-through.
- Then Next.js UI + deploy to Vercel + /evals page (graded). Then fetch_page, search cache, docs/RAG (Atlas).

---

## 2026-09-15 · Session 5: agent service boots — /health live (2-day deadline)

**Context**
- Malik set a hard **2-day deadline** to finish LUMINA. Agreed to keep build-along but take bigger steps
  (a file at a time) and build in priority order so any stopping point is a deployable slice. Keys + Atlas
  not set up yet (he's buying accounts) → build the parts that need no external services first.

**Did**
- `backend/agent/package.json` + `tsconfig.json` (scaffolded by tutor — same pattern as contract; strict,
  NodeNext, esModuleInterop). Deps: express, pino, pino-http, tsx, @lumina/contract (workspace link).
- `backend/agent/src/index.ts`: Express server on AGENT_PORT (8000), pino-http request logging, and
  `GET /health` that builds the body from env (with `?? "unconfigured"` fallbacks) and returns
  `HealthResponse.parse(body)` — the contract validating the response on the way OUT.

**Proved**
- `npm run typecheck --workspace backend/agent` green (after fixing pino-http import: named `{ pinoHttp }`,
  not default — NodeNext default export isn't callable).
- Started `npm run dev`, `curl http://localhost:8000/health` -> correct contract-shaped JSON, 200, and a
  single structured pino JSON log line for the request. Server stopped after.

**Learned**
- The contract works in reverse: `.parse()` on responses stops the service returning a wrong shape.
- Env vars are `string | undefined`; a strict string schema throws on undefined unless you default them.
- pino-http needs a named import under NodeNext.

**Next**
- `POST /threads/:id/ask` + the loop skeleton: stream SSE `trace -> sources -> token -> done` using the
  AskEvent schemas, with TOOLS STUBBED (no keys needed). Then wire real Anthropic + Tavily when keys land.
- Then gateway, then deploy. Still pending: Mongo collection schemas, Atlas cluster, .env.

---

## 2026-09-13 · Session 4: contract package — /ask SSE events + build

**Did**
- `src/sse.ts`: all five stream events as objects with a literal `event` discriminant —
  `TokenEvent`, `TraceEvent`, `SourcesEvent` (array of a `Source` discriminated union: WebSource |
  DocSource keyed on `kind`, DocSource reuses `DocumentId` + a `locator` z.object of optional
  page/heading/line), `DoneEvent` (tokens nested z.object, top-level `terminated` enum), `ErrorEvent`
  (`status: z.literal(502)`). Combined into `AskEvent = z.discriminatedUnion("event", [...])`.
- `src/index.ts`: barrel file re-exporting primitives, ask, sse (with `.js` extensions).
- Continued same session — added the rest of the HTTP routes:
  - `documents.ts`: `DocumentStatus` enum (pending→parsing→embedding→indexed|failed), `CreateSpaceResponse`,
    `UploadDocumentResponse` (status = z.literal("pending")), `Document`, `ListDocumentsResponse`.
  - `threads.ts`: `CreateThreadResponse`, `Message` (role enum, sources/artifacts placeholdered z.array(z.unknown())),
    `ThreadMessagesResponse`.
  - `memory.ts`: `Memory`, `MemoryListResponse`.
  - `artifacts.ts`: `ArtifactKind`/`ArtifactStatus` enums, `CreateArtifactRequest`, `CreateArtifactResponse`
    (status = z.literal("pending")), `ArtifactStatusResponse` (full enum), `RateLimitError`.
  - `ops.ts`: `HealthResponse`, `StatsResponse`, `EvalReport` (rubric/bench/quality/trajectories placeholdered).
  - All wired into `index.ts`. 31 exported schemas across 8 files.

**Proved**
- `npm run typecheck` green after each schema.
- `npm run build` (tsc) emitted 9 `dist/*.js` (+ .d.ts) — the files `package.json` main/types point at now
  exist, so the package is consumable. Full route surface builds clean.

**Learned / debugged**
- "Move" = copy + delete: SSE events were copied into sse.ts but left in ask.ts (broken dup) → typecheck
  failed until ask.ts was trimmed. Also: unsaved editor buffer is invisible to disk-reading tools.
- **Green typecheck != correct contract.** Three spec bugs compiled fine: `coustUsd` typo (should be
  costUsd), `terminated` nested inside `tokens` instead of a top-level sibling, and `z.literal("502")`
  (string) instead of `z.literal(502)` (number). Contract correctness is verified by reading against the
  spec field-by-field, not by a green compile.
- Discriminated unions used at two levels (Source by `kind`, AskEvent by `event`); `z.literal` works for
  numbers; every Zod type is a function call; nested objects need `z.object()`.
- Recurring theme: schema = shape, code = behavior (SSE order, fail-loud), tests = proof.

**Next**
- All HTTP routes now schematised. Remaining contract work: the Mongo **collection** schemas
  (threads, memories, chunks, cache, jobs) and tightening the placeholders (message sources/artifacts,
  EvalReport internals). Change ops.ts placeholders from z.array(z.unknown()) → z.unknown() (rubric/bench/
  quality are probably objects; z.array would reject them). Consider gitignoring `packages/contract/dist`.
- Then agent service `/health` + the ask loop.

---

## 2026-09-10 · Session 3: contract package started (skeleton + first schemas)

**Did**
- Started `packages/contract/` (contract-first, no external deps needed).
- `package.json`: @lumina/contract, type=module, version/main/types, build+typecheck scripts, zod + typescript deps.
- `tsconfig.json`: strict, NodeNext, src -> dist, declaration true.
- `src/primitives.ts`: `Mode` enum (auto|web|docs) + prefixed ID schemas (ThreadId thr_, DocumentId doc_,
  ArtifactId art_, SpaceId spc_), each with `z.infer` type.
- `src/ask.ts`: `AskRequest` = { query: string.min(1), mode: Mode, spaceId: SpaceId.optional() } + inferred type.

**Proved**
- `npm install --workspace packages/contract` -> added zod + typescript, 0 vulnerabilities.
- `npm run typecheck --workspace packages/contract` (tsc --noEmit) -> clean, no errors, after each schema file.

**Learned / debugged**
- Hit a real EJSONPARSE: compilerOptions + `//` comments had been pasted into package.json. Two lessons:
  content-in-the-right-file (compilerOptions -> tsconfig), and package.json must be strict JSON (no comments;
  tsconfig is JSONC and tolerates them).
- NodeNext resolution needs the `.js` extension on relative imports even from `.ts` files.
- z.infer = single source of truth: hand-writing the TS type separately would let runtime + type drift.

**Next**
- SSE event schemas (trace, sources, token, done, error) + discriminated union (encodes the DESIGN.md
  trace->sources->token->done order). Then wire `src/index.ts` to re-export everything (currently exports nothing).
- Then the rest of the contract routes/collections, then agent service /health + loop.

---

## 2026-09-08 · Session 2: DESIGN.md completed (design gate passed)

**Did**
- Finished all five sections of [[DESIGN]] plus the appendix; flipped its status header to "Written".
- Section 1: added the **jobs worker** as a component (was missing) and framed the `jobs` collection
  as the mailbox between the fast API and the slow worker.
- Section 2: added the *why* behind each boundary — keys only in the agent service (secrets never
  reach the browser; least-exposed layer), gateway validates the contract (security wall), PDF parse
  off the request path (too slow for the <300ms 202).
- Section 3: wrote both flows — Flow A (ask, synchronous, SSE order trace→sources→token→done) and
  Flow B (upload/artifact, 202-then-poll), with `jobs` as the only channel to the worker.
- Section 4: added jobs status transitions (queued→running→done/failed), crash-safety/retry, run logs.
- Section 5: rewrote all seven trade-offs in a consistent "chose X / gave up Y / right because Z"
  shape — vector store, job queue, UI, Tavily vs SerpApi, full-page fetch, hard caps, read-your-write.
- Appendix: logged assumptions (Tavily, 6h cache TTL, retry max, Atlas-M0-not-mongod) and open
  questions for the instructor.

**Proved**
- No code run. This was design only. DESIGN.md now has no remaining TODO blocks.

**Learned**
- Recurring self-check when writing a trade-off: the "gave up" must be a downside of the option you
  **picked**, never a flaw of the option you rejected — that flaw is your "why it's right." Caught this
  slot-swap three times (Redis, Tavily, vector store).

**Next**
- Own-words read-through of DESIGN.md (rubric red line), then tweak voice on sections built together.
- Create the M0 Atlas cluster; write `scripts/create-indexes.mjs`; verify the three search indexes.
- Then start the contract package (`packages/contract/`), then the agent service `/health` + loop.

---

## 2026-09-06 · Session 1: spec analysis and scaffold

**Did**
- Read `PRD.md`, `AGENTS.md`, `README.md` for Assignment 1 in full.
- Read the module's `reference/` notes and the Alex reference app, including its `run_tool_loop`.
- Derived a full product requirements document: problem, goals, non-goals, users, stories, Given/When/Then acceptance criteria, risks, open questions, success metrics.
- Scaffolded `Lumina/` following the Claude Code anatomy layout: `CLAUDE.md`, `.claude/{settings.json,agents,commands,skills}`, `docs/`, `memory/`, `scripts/`, plus the workspace folders `web/`, `backend/gateway/`, `backend/agent/`, `packages/contract/`, `benchmark/`, `eval/`, `quality/`.
- Copied the three provided config files in: `sla.json`, `rubric.json`, `expectations.json`.
- Recorded seven stack decisions in [[DECISIONS]].

**Proved**
- Nothing runs yet. No code was written. This was reading and structure only.

**Learned**
- The eight automated rubric items are storage-agnostic: they all assert through HTTP. Only the
  5-point manual deploy item names Atlas. But `AGENTS.md` phrases five Must-level requirements in
  MongoDB-only syntax, and the provided `create-indexes.mjs` is a Mongo script.
- The staff scaffold has not shipped. Nothing in the assignment folder except docs and three JSON files.

**Decided**
- **MongoDB confirmed** as the database, after checking what was available. Supabase is dropped;
  the reasoning both ways is preserved in [[DECISIONS]] D4 because ARGUS raises the same question again.
- Still open: search provider (Tavily recommended) and whether an M0 Atlas cluster exists yet.

**Next**
- Fill in [[DESIGN]]. It blocks all code per `AGENTS.md`.
- Create a free M0 Atlas cluster, then write `scripts/create-indexes.mjs` and verify the three
  search indexes exist. A local `mongod` will not do: no vector search, no BM25 text index.

---

## Template for the next entry

```markdown
## YYYY-MM-DD · Session N: <title>

**Did**
-

**Proved**
- <command> -> <what the output showed>

**Learned**
-

**Next**
-
```
