# API.md: the LUMINA contract, restated

**Source of truth is [`../../PRD.md` section 7](../../PRD.md) and, once written, the zod schemas in
`packages/contract/`.** This file is a quick-lookup copy. If they disagree, the PRD and the schemas win.

All routes are served by the gateway (`:8787`) and forwarded with the same shapes to the agent
service (`:8000`). `X-User-Id` is required on every route except `/health` (`401` without it).
`X-Request-Id` is reused if inbound, else generated at the gateway, and logged by both services.

## Threads and asking

```
POST /threads                       -> 201 { threadId: "thr_…" }
GET  /threads/{id}                  -> 200 { messages: [ { role, content, sources: [...], artifacts: [...] } ] }

POST /threads/{id}/ask              body: { query, mode: "auto" | "web" | "docs",
                                            depth?: "quick" | "deep",  (default "quick")
                                            spaceId?: "spc_…" }
  -> 200 text/event-stream, events in this order:
     quick:  trace* -> sources -> token* -> done
     deep:   plan  -> trace* -> sources -> token* -> done

  event: plan     { subQuestions: [ { i, question, reason? } ], reason? }   (deep only, before any retrieval)
  event: trace    { step, tool, input, ok, ms, reason?, error?, subQuestion? }   (one per tool call)
  event: sources  [ { n, kind: "web", title, url, snippet, subQuestion? },
                    { n, kind: "doc", docId, title, locator: { page | heading | line }, snippet, subQuestion? } ]
  event: token    { text }                                          (many)
  event: done     { answerId, latencyMs, ttftMs, model, tokens: { in, out }, costUsd,
                    searchCached, terminated: "done" | "cap",
                    depth: "quick" | "deep", subQuestions? }
  event: error    { status: 502, error }                             (instead of done, on provider failure)
```

Rules: `sources` arrives before the first `token`. Every `[n]` in the text has exactly one matching
`n` in `sources`. `latencyMs`, `ttftMs`, `costUsd` are measured server-side.

Deep search rules: the `plan` event is emitted before any retrieval happens; every retrieval trace
step and every source carries the `subQuestion` index it served; the merged citation numbering is
contiguous from 1 with each page appearing once. `depth` is opted into per request and the server
never upgrades a quick search on its own — `plan_research` is never called from a quick run.
Over the deep daily cap: `429 { error, resetsAt }`, refused before the stream opens.

## Memory

```
GET    /memory                      -> 200 { memories: [ { id, text, sourceThread, createdAt } ] }
DELETE /memory/{id}                 -> 204
```

## Spaces and documents

```
POST /spaces                        -> 201 { spaceId: "spc_…", name }
POST /spaces/{id}/documents         multipart file (PDF, MD, TXT, <= 25 MB)
                                    -> 202 { docId: "doc_…", status: "pending" }   in < 300 ms
GET  /spaces/{id}/documents         -> 200 { documents: [ { docId, title, status, pct, pages?, error? } ] }
                                       status: pending -> parsing -> embedding -> indexed | failed
```

## Artifacts

```
POST /artifacts                     { kind: "deck" | "image", threadId, answerId?, prompt? }
                                    -> 202 { artifactId: "art_…", kind, status: "pending" }   in < 300 ms
GET  /artifacts/{id}                -> 200 { status: "pending" | "ready" | "failed", url?: "/artifacts/{id}/file",
                                            outline?, promptUsed?, model?, costUsd?, error? }
GET  /artifacts/{id}/file           -> 200 .pptx or image/png
```

Image over the daily cap: `429 { error, resetsAt }`.

## Operations

```
GET /health                         -> 200 { status, model, searchProvider, vectorStore, db, ai: { status } }
GET /stats                          -> 200 { requests, answers, searchCacheHitRatePct, ttftP95Ms,
                                            costUsdToday, imagesToday, imageDailyCap,
                                            deepToday, deepDailyCap }
                                       deepToday is per X-User-Id, read from the same counter the cap reserves against
GET /evals/report.json              -> 200 { assignment, student, repo, video, deployedAt, rubric, bench, quality, trajectories }
```

## Status codes

| Code | Meaning |
|---|---|
| 400 | invalid input (zod) |
| 401 | missing `X-User-Id` |
| 404 | unknown thread, space, or artifact |
| 413 | file too large |
| 429 | rate limit or image daily cap |
| 501 | not implemented yet |
| 502 | upstream failure (LLM, search, embeddings, image) |

## Tools available to the ask loop

`web_search`, `fetch_page`, `search_documents`, `recall_memory`, `save_memory`.
Never `make_presentation` or `generate_image`; those run only behind `POST /artifacts`.
Caps: 8 tool calls, 90 s. Cap hit means `terminated: "cap"`. Exception means `terminated: "error"` and `502`.
