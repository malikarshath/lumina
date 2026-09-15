# LUMINA

> A Perplexity-style AI search engine. Ask a question, get a streamed, cited answer built from
> live web search and your own documents. It remembers you across sessions. Any answer can become
> a slide deck or an image on demand.

This folder is the **implementation** of Assignment 1. The spec lives one level up:

- [`../PRD.md`](../PRD.md): product requirements, fixed API contract (section 7), data model, SLA, quality bar
- [`../AGENTS.md`](../AGENTS.md): non-negotiables
- [`../README.md`](../README.md): the course's build guide, grading, and troubleshooting

## Stack

**Frontend** React via Next.js, Tailwind CSS, deployed on Vercel (`web/`).
**Backend** Node 20, Express, TypeScript. Two services: a gateway on `:8787` and an agent service on `:8000`.
**AI** Anthropic Claude API for reasoning and tool use, OpenAI embeddings for semantic search, RAG over
MongoDB Atlas Vector Search, `gpt-image-1` for images.
**Database** One MongoDB Atlas cluster for everything: threads, messages, memories, chunks, search cache, jobs, artifacts, GridFS files, vectors.

Why these choices: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## What we build

| Capability | Where |
|---|---|
| Retrieval: web search + page fetch, documents via hybrid vector + BM25 search | `backend/agent/src/tools/`, `backend/agent/src/rag/` |
| Citations: every `[n]` resolves to a source retrieved in that request | `backend/agent/src/loop/` |
| Structured answers: streamed SSE with `trace -> sources -> token -> done` | `backend/agent/src/loop/`, `backend/gateway/` |
| Memory: thread history + long-term, semantic recall, listable and deletable | `backend/agent/src/memory/` |
| Artifacts: deck (`pptxgenjs`) and image (`gpt-image-1`) as async `202` jobs | `backend/agent/src/artifacts/`, `backend/agent/src/worker/` |
| UI: query, stream, citation chips, sources rail, memory panel, Spaces, deck/image actions, `/evals` | `web/` |

## Status

**Scaffold only.** No application code yet. The next step is `docs/DESIGN.md`, which must be
written before any code (see `../AGENTS.md`).

## Build order

Follow `../README.md` sections "Build it" and "Definition of Done". Summary:

0. Fill in `docs/DESIGN.md`. Copy `.env.example` to `.env`. Create an Atlas M0 cluster.
1. `packages/contract/`: zod schemas for every route, SSE event, and collection document.
2. `backend/agent/`: `/health`, then the loop with `web_search` + `fetch_page` and SSE. Test with `curl -N`.
3. Search cache (LRU + `searchCache` TTL collection), threads + messages, memory, run logs.
4. `backend/gateway/`: CORS, `X-User-Id`, `X-Request-Id`, pino, zod validation, rate limit, SSE pass-through.
5. `web/`: Next.js UI against the gateway.
6. Spaces + jobs worker + hybrid retrieval + read-your-write probe.
7. Artifacts: deck, then image with cap and `DRY_RUN`.
8. `bench.mjs` green against `benchmark/sla.json`, `check.mjs` exit <= 1.
9. Deploy: agent + gateway on Fly.io, UI on Vercel. Run `/fde-lumina-eval` against the deployed gateway.

## Run (once implemented)

```bash
npm install
cp .env.example .env
node scripts/create-indexes.mjs
npm run dev            # gateway :8787, agent :8000, web :3000
```

## Self-verify (all must pass before claiming done)

```bash
curl -sf localhost:8000/health && curl -sf localhost:8787/health
T=$(curl -s -X POST localhost:8787/threads -H 'x-user-id: dev' | jq -r .threadId)
curl -N -X POST localhost:8787/threads/$T/ask -H 'x-user-id: dev' -H 'content-type: application/json' \
  -d '{"query":"latest on EU AI Act GPAI obligations","mode":"web"}' | grep -m1 '^event: sources'
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8787/threads/$T/ask -d '{}'   # expect 401
ls runs/*.json | head -1 && node quality/check.mjs .
node benchmark/bench.mjs
git status --porcelain | grep -E '\.env$|node_modules|^runs/|^reports/' && echo "FAIL: unstage" || echo clean
```
