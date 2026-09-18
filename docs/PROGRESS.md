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

LUMINA is built, deployed, and working end to end. Almost everything in the **original** rubric is
done with real evidence (see the tracker below). **One thing changed the ground under this on
2026-09-18: course staff shipped the official LUMINA scaffold, and swapped 20 rubric points from
deck/image generation to a "Deep Search" mode with a specific, different contract.** That scaffold
landed at `Assignment_1_Lumina/` (sibling to this `Lumina/` folder, in the outer course repo) — it
does not touch this repo at all, confirmed by diffing the pull (0 of 81 changed files touch this
directory). But its `eval/rubric.json` and `benchmark/sla.json` are now the source of truth for
scoring, and our Deep Search implementation does not yet match its exact checks.

**The one open, well-defined piece of work:** close the four gaps below (deep_search, 15 auto pts).
Everything else is done, proven, and deployed.

1. Contract: our `mode: "deep"` needs a dedicated `plan` SSE event, streamed *before* any retrieval
   (currently just a `trace` step, folded in with everything else).
2. Every trace step *and every source* needs a `subQuestion` field (we have it on `fetch_page`
   trace steps; sources don't carry it at all).
3. A `DEEP_DAILY_CAP` (default 5/user/day) with `429 {error, resetsAt}` on the
   `(cap+1)`th request — same pattern as the existing `IMAGE_DAILY_CAP`, just missing for deep search.
4. Rename the planning tool/step from `plan_subquestions` to `plan_research` — the new rubric's red
   line names it literally ("`plan_research` never called from a quick search").

Also worth a look, not yet measured: `min_deep_source_ratio: 2.0` (deep must retrieve ≥2x the
distinct sources of the same query run quick) and `max_cost_per_deep_answer_usd: 0.35` /
`deep_answer_p95_s: 90` (our one real test: ~$0.08, ~31s — comfortably inside both, but only one
data point).

## Deployed

- **UI:** https://lumina-web-phi-ashy.vercel.app/ — Vercel, auto-deploys on push to `main`.
- **Backend (gateway+agent, one Render service):** https://lumina-fb9s.onrender.com — agent is not
  separately publicly reachable; the gateway proxies everything.
- **Database:** MongoDB Atlas M0, all three search indexes live (vector, text, TTL).
- Both confirmed live and running the latest pushed commit as of 2026-09-18 (checked `/stats`,
  `/threads/:id` 404 behavior, and the mode-enum validation error listing `deep` — see
  [[BUILD-LOG]] for the exact commands).

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
| Deep Search (quick/deep, planner + parallel sub-question research) | done, but **does not yet match the newly-shipped official contract** — see TL;DR |
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
| 5 | Deep search (automated) | 15 | auto | **built, contract mismatch** | Planner → parallel search → parallel fetch → merge → synthesis works and is proven ([[BUILD-LOG]] Sessions 23–24), but is missing the `plan` event, `subQuestion` on sources, the daily cap, and the `plan_research` tool name the *new* official rubric checks for. See TL;DR. |
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
- [x] **Gate 1 CONTRACT** — `node quality/check.mjs .` passes clean on real runs; confirmed it also correctly fails on a synthetic bad run (Session 20).
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
| Deep search source ratio | >= 2.0x quick | not yet measured | — |
| Deep search cost | <= $0.35 | ~$0.08 (one real run) | PASS (thin evidence) |
| Deep search p95 | <= 90 s | ~31 s (one real run) | PASS (thin evidence) |

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
- [ ] `plan_research` never called from a quick search — **new red line as of 2026-09-18's rubric update; our deep-mode planning tool is currently named `plan_subquestions`, not `plan_research`.** Functionally satisfied (deep is a fully separate code path from quick), but the literal name doesn't match.
- [x] Design section on `/evals` is in my own words

## Blockers

| Blocker | Since | Owner | Note |
|---|---|---|---|
| Deep search doesn't match the newly-shipped official contract (`plan` event, `subQuestion` on sources, daily cap, `plan_research` naming) | 2026-09-18 | me | See TL;DR at the top. This is the one real open coding task. |
| Manual grading items require Malik's own action (P1 is explicitly a learner action) | ongoing | Malik | Deep-search-quality judgment (5 pts) and the trajectory read-through write-up (part of 5 pts) can't be done by the tutor on his behalf. |
| No browser tool available this session | ongoing | environment | UI changes (Trace/Sources sidebar, deep mode button, markdown rendering) verified via build output, bundle contents, and real API data — never visually clicked through. |

**Resolved**

| Was blocking | Resolved | Outcome |
|---|---|---|
| Database: Supabase vs. MongoDB | 2026-09-06 | MongoDB confirmed by Malik. See [[DECISIONS]] D4. |
| Staff scaffold not shipped | 2026-09-18 | Shipped, at the sibling `Assignment_1_Lumina/` path — but scope changed (deck/image → deep search) as a result. See TL;DR. |
| Search provider unconfirmed | resolved early | Tavily, see [[DECISIONS]] D3. |
| Atlas cluster not yet created | resolved early | M0 free tier, 3 search indexes, all in use. |
| TTFT far over target (26.8s) | 2026-09-17 | Parallelized tool execution within a turn (Promise.all, split I/O from shared-state mutation to avoid a citation-index race) — real 2-2.8x improvement to 9.6s. Still over target; architectural floor, not further reducible without reopening the grounding-vs-latency trade-off. |
