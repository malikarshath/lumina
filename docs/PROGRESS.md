---
project: LUMINA
assignment: FDE Assignment 1
due: end of Week 2
updated: 2026-09-06
---

# LUMINA: progress dashboard

Hub note. Related: [[DESIGN]] · [[DECISIONS]] · [[API]] · [[ATLAS-SETUP]] · [[BUILD-LOG]]

> Keep this honest. A box is checked only when the verify command passed, not when the code
> looks right. Inspection is not verification.

## Phase

| Phase | State |
|---|---|
| Read the spec (PRD, AGENTS, README) | done |
| Scaffold folders and config | done |
| `docs/DESIGN.md`, five questions | **not started, blocks all code** |
| `packages/contract/` zod schemas | not started |
| Agent service: loop + search + SSE | not started |
| Gateway | not started |
| UI | not started |
| Spaces + RAG + worker | not started |
| Artifacts: deck, image | not started |
| Bench green, gates pass | not started |
| Deploy + submit Vercel URL | not started |

## Rubric tracker (100 pts)

Points are claimed only with evidence. "Evidence" means a command output, a run log, or a
screenshot, not an opinion.

| # | Area | Pts | Type | State | Evidence |
|---|---|---|---|---|---|
| 1 | UI lights up & contract | 10 | auto | not started | |
| 2 | Search & cited answers | 20 | auto | not started | |
| 3 | Memory, thread + long-term | 10 | auto | not started | |
| 4 | RAG over documents | 15 | auto | not started | |
| 5 | Presentation, auto half | 5 | auto | not started | |
| 6 | Presentation, human half | 5 | manual | not started | |
| 7 | Image generation + cost gate | 10 | auto | not started | |
| 8 | Performance & SLA | 10 | auto | not started | |
| 9 | Observability | 5 | auto | not started | |
| 10 | Human gate & answer quality | 5 | manual | not started | |
| 11 | Deploy & docs | 5 | manual | not started | |

Bonus available: +5 for a new rule with a real precedent, +5 for the subagent split.

## The six gates

`eval.mjs` runs these in order and stops at the first failure.

- [ ] **Gate 0 STATIC** lint and typecheck clean; no `.env`, `runs/`, or `reports/` in `git status`
- [ ] **Gate 1 CONTRACT** `node quality/check.mjs .` passes C1
- [ ] **Gate 2 RUN** `node benchmark/bench.mjs --smoke`, five queries inside budget, all `terminated: "done"`
- [ ] **Gate 3 TRAJECTORY** `check.mjs` over `runs/` passes A1, A2, A3, R2
- [ ] **Gate 4 EVAL** full bench, `reports/eval.json` meets E1 and E2 plus every SLA percentile
- [ ] **Gate 5 HUMAN** one successful and one failing trajectory read end to end and written up

## SLA targets

Declared in `benchmark/sla.json` before the first run. Fill the "actual" column only from a real run.

| Metric | Target | Actual |
|---|---|---|
| TTFT p95 | <= 2500 ms | |
| Full answer p95 | <= 12000 ms | |
| 202 accept p95 | <= 300 ms | |
| Citation grounding | >= 95 % | |
| RAG recall@5 | >= 0.70 | |
| Search cache hit rate | >= 50 % | |
| Deck p95 | <= 60 s | |
| Image p95 | <= 45 s | |
| Error rate | <= 1 % | |
| Cost per answer | <= $0.05 | |

## Red lines

Any one of these fails the submission regardless of score.

- [ ] No secret reachable from the deployed app
- [ ] Provided folders unmodified
- [ ] No fabricated citation in the bench sample
- [ ] No `2xx` answer served on a provider exception
- [ ] No capped run reported as `terminated: "done"`
- [ ] Artifact tools never called from the ask path
- [ ] Design section on `/evals` is in my own words

## Blockers

| Blocker | Since | Owner | Note |
|---|---|---|---|
| Staff scaffold not shipped: `web/` UI, `packages/contract/`, `bench.mjs`, `eval.mjs`, gold set, `quality/` kit, `create-indexes.mjs` | 2026-09-06 | course staff | PRD section 15 lists all as "to be built". We build our own until they land. |
| Search provider unconfirmed | 2026-09-06 | me | Tavily recommended, see [[DECISIONS]] D3 |
| Atlas cluster not yet created | 2026-09-06 | me | Atlas agreed. Steps and the three index definitions are in [[ATLAS-SETUP]]. M0 free tier, 3 search indexes, all 3 used. |

**Resolved**

| Was blocking | Resolved | Outcome |
|---|---|---|
| Database: Supabase vs. MongoDB | 2026-09-06 | MongoDB confirmed by Malik. See [[DECISIONS]] D4. |
