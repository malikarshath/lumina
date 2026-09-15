# scripts/

One-off tooling that is not part of either service.

| Script | Status | Purpose |
|---|---|---|
| `create-indexes.mjs` | TODO | Creates every MongoDB index from one JSON definition: the `memories` vector index (cosine, `userId` filter), the `chunks` vector index (`spaceId` filter), the `chunks` Atlas Search text index (BM25), the `searchCache` TTL index on `expiresAt`, and the plain compound indexes from PRD section 8. Idempotent. |
| `indexes.json` | TODO | The single definition `create-indexes.mjs` reads. |
| `seed-gold-corpus.mjs` | TODO | Uploads the `eval/gold/` corpus into a Space through the gateway so the RAG gold set can be benchmarked. |
| `export-runs.mjs` | TODO | Dumps the `runs` collection of a deployed instance into `runs/` so `quality/check.mjs` can read it locally. Wired to `npm run export:runs`. |

The PRD lists `create-indexes.mjs` as provided by course staff. If it ships, drop it here and delete
the TODO; do not maintain two copies.
