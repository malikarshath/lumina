# DECISIONS.md: stack decisions for LUMINA

One entry per decision. Newest at the bottom. Each entry says what was decided, why, and what it
rules out. Add to this file whenever a choice is made that the code alone would not explain.

---

## D1. LLM: Anthropic Claude API (2026-09-06)

**Decision.** All reasoning, tool selection, answer synthesis, deck outlines, and image prompts go
through the Anthropic Claude API. Default model `claude-sonnet-5`, set via `LLM_MODEL`.

**Why.** The learner's choice. It also matches the benchmark's cost model in `benchmark/sla.json`
(`llm_provider: anthropic`, `claude-sonnet-5`, $3 in / $15 out per million tokens), so the dollar
figures the bench reports are meaningful without editing the SLA file. The Alex reference app uses
Anthropic too, so its loop is directly portable.

**Rules out.** Nothing permanently. The PRD requires provider-swappable via env, so the LLM client
must sit behind one adapter with the provider named in `/health`.

## D2. Embeddings: OpenAI `text-embedding-3-small` (2026-09-06)

**Decision.** Embeddings for memories and document chunks use OpenAI `text-embedding-3-small`.

**Why.** The PRD data model fixes `embedding[1536]` on both `memories` and `chunks`, which is this
model's dimension. Anthropic does not offer an embeddings endpoint. The bench cost model already
prices this model.

**Rules out.** Switching embedding model after indexing without re-indexing everything. An index is
only searchable by the model that built it.

## D3. Search provider: Tavily by default (2026-09-06, recommended, pending learner confirmation)

**Decision.** `SEARCH_PROVIDER=tavily`. SerpApi remains a supported swap.

**Why.** The PRD names Tavily `extract` as the default full-page reader. With SerpApi the page
fetch must be built by hand (`@mozilla/readability` + `jsdom`). Tavily's free tier covers the two
weeks, and the Alex reference app already has a working Tavily client to read.

**Rules out.** Nothing. The provider adapter and `/health.searchProvider` keep the swap honest. The
eval flips `SEARCH_PROVIDER` for one call, so both paths must at least start.

## D4. Database: MongoDB Atlas, one cluster, vectors inside (2026-09-06)

**Decision.** One Atlas M0 (free) cluster holds every collection, GridFS, the search cache, the
jobs queue, and the vectors via Atlas Vector Search. Local `docker compose` `mongod` is a dev-only
fallback with `VECTOR_BACKEND=mongo-cosine-scan`, and `/health` must report it.

**Why.** This is a hard requirement in `../AGENTS.md` ("RAG (MongoDB Atlas)", one `chunks`
collection, `$vectorSearch` with `spaceId` filter, read-your-write probe). Three graded features
exist only on Atlas: the vector index, the BM25 text index for hybrid retrieval, and the probe.
M0 allows exactly the three search indexes LUMINA needs.

**What about Supabase?** Worth stating precisely, because Supabase is not technically incapable here.

Postgres with `pgvector` can do everything LUMINA needs, and arguably does hybrid retrieval more
neatly: `pgvector` for dense search, `tsvector` for BM25, reciprocal rank fusion in one SQL query
instead of two Atlas stages fused in Node. Supabase Storage replaces GridFS. `pg_cron` or a
`WHERE expires_at > now()` predicate replaces the TTL index. `SELECT ... FOR UPDATE SKIP LOCKED`
is a better job queue than `findOneAndUpdate`.

So the objection is not capability. It is three concrete things:

1. **`AGENTS.md` phrases five Must-level requirements in MongoDB-only syntax**: one `chunks`
   collection with `spaceId` as a filter field *inside* `$vectorSearch`, GridFS for uploads, a TTL
   index on `searchCache.expiresAt`, the atomic `findOneAndUpdate` job claim, and `/health`
   reporting `vectorStore: "atlas-vector-search"`. That file opens with "Do not relax, reinterpret,
   or 'improve' these requirements. Conform to them."
2. **One graded item names Atlas.** `eval/rubric.json`, manual item `deploy_docs`, 5 points:
   "services on Fly.io or Vercel against an Atlas cluster."
3. **A provided, do-not-edit script is Mongo-only.** `scripts/create-indexes.mjs` creates the
   vector, text, and TTL indexes. On Supabase it would have to be replaced, and `../AGENTS.md`
   lists `scripts/` as do-not-edit.

What is *not* at risk: all eight automated rubric items, worth 80 points, assert through HTTP only.
They never inspect the database. The contract in PRD section 7 is storage-agnostic, and so is
`bench.mjs`.

**Resolved 2026-09-06: MongoDB confirmed.** Malik checked the database and chose MongoDB, so the
Supabase question is closed for this build and no ruling from Hamza is needed. The analysis above
stays on record because ARGUS in Module 3 uses Qdrant, and the same "is this contract or is this
convention" judgement comes back there.

**One thing this decision still depends on: Atlas, not a local `mongod`.** Vector search, the
BM25 text index, and the read-your-write probe are Atlas Search features. A local or self-hosted
MongoDB has none of them, and the free M0 tier is what gives them at no cost. If only a local
instance is available, `VECTOR_BACKEND=mongo-cosine-scan` keeps development moving, but `/health`
must say so and `recall@5` cannot be graded on it.

**Containment.** All database access sits behind `backend/agent/src/db/`, and retrieval behind
`src/rag/` and `src/tools/searchDocuments.ts`. A swap touches those folders and `/health`, not the
loop, the routes, or the contract.

**Also rules out.** Supabase Auth and Stripe regardless of the database choice. PRD section 3 makes
accounts, OAuth, and billing explicit non-goals; identity is the `X-User-Id` header.

## D5. UI: Next.js + Tailwind on Vercel (2026-09-06)

**Decision.** The UI in `web/` is a Next.js app styled with Tailwind, deployed to Vercel. It
imports types from `packages/contract/` and speaks only to the gateway.

**Why.** The learner's stack. The PRD lists "learner-built UI in Next.js on Vercel, still passing
the contract" as a sanctioned stretch goal, and the staff-provided Vite UI is not in the repo yet.
The submission is a Vercel URL that must render `/evals`, which Next.js handles naturally.

**Rules out.** Relying on the provided UI as the acceptance test. Our UI must exercise every route
in the contract so that the same rubric checks pass. If the staff UI ships later, it should also
work unmodified against our gateway; that is the real test.

## D6. Two Express services, TypeScript (2026-09-06)

**Decision.** Gateway on `:8787` (browser-facing concerns) and agent service on `:8000` (loop,
tools, keys, worker), both Express on Node 20 with TypeScript.

**Why.** Required by the PRD architecture and the FDE house pattern. TypeScript because the shared
zod contract types are the point; `npm run typecheck` is Gate 0.

**Rules out.** A single service, and any provider key reaching the gateway or the browser.

## D7. Async work: `jobs` collection + in-process worker, no broker (2026-09-06)

**Decision.** Uploads and artifacts insert a `jobs` row and return `202`. A worker loop claims work
with an atomic `findOneAndUpdate`, runs it off the main thread (`worker_threads` or `npm run worker`),
and a sweeper returns stale `running` rows to `pending`.

**Why.** Required by the PRD (section 6) and AGENTS.md. No Redis, no extra infra. ARGUS later swaps
Prefect in against the same contract.

**Rules out.** Synchronous parse-then-respond endpoints. The PRD says those fail even if they work.
