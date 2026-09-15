---
project: LUMINA
type: setup
updated: 2026-09-06
---

# MongoDB Atlas setup

Decided in [[DECISIONS]] D4. Related: [[PROGRESS]] · [[API]]

Free **M0** tier is enough for the two weeks. M0 allows **3 Atlas Search indexes** and 512 MB, and
LUMINA needs exactly 3. Do not spend one on anything else.

## 1. Create the cluster

1. Sign in at `cloud.mongodb.com`, create a project called `lumina`.
2. Build a cluster, choose **M0 free**, pick the region closest to where the agent service will
   deploy on Fly.io. Cross-region adds latency to every query, and TTFT p95 is graded at 2500 ms.
3. **Database Access**: add a database user with a strong password. Read and write to any database
   is fine for this project.
4. **Network Access**: add your own IP for local development. Before deploying, add `0.0.0.0/0`
   or, better, Fly's egress IPs. An unreachable database looks exactly like a broken service.
5. Copy the connection string into `MONGODB_URI` in `.env`. Append the database name: `/lumina`.

The connection string is a secret. It goes in `.env`, which is git-ignored, and into
`fly secrets set` at deploy time. It is never bundled into the UI and never returned by an endpoint,
which is one of the red lines in `eval/rubric.json`.

## 2. The three search indexes

These are Atlas Search indexes, created from the Atlas UI under **Search** or by
`scripts/create-indexes.mjs`. They are separate from ordinary MongoDB indexes and do not count
against each other.

### Index 1: `memories_vector` on the `memories` collection

Semantic recall of long-term memory, always filtered to one user.

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" },
    { "type": "filter", "path": "userId" }
  ]
}
```

### Index 2: `chunks_vector` on the `chunks` collection

Dense half of document retrieval. `spaceId` **must** be a filter field here, so the filter runs
inside `$vectorSearch` rather than in a later `$match`. Filtering afterwards returns chunks from
other Spaces, which is a listed troubleshooting symptom in the assignment README.

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" },
    { "type": "filter", "path": "spaceId" }
  ]
}
```

### Index 3: `chunks_text` on the `chunks` collection

BM25 half of hybrid retrieval, fused with the vector results by reciprocal rank fusion.

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "text": { "type": "string" },
      "spaceId": { "type": "token" }
    }
  }
}
```

## 3. Ordinary indexes

Not Atlas Search, so unlimited on M0. From PRD section 8.

| Collection | Index | Purpose |
|---|---|---|
| `searchCache` | `{ expiresAt: 1 }` with `expireAfterSeconds: 0` | **TTL.** Mongo deletes rows once `expiresAt` passes. |
| `threads` | `{ userId: 1, createdAt: -1 }` | thread list per user |
| `messages` | `{ threadId: 1, createdAt: 1 }` | thread history in order |
| `spaces` | `{ userId: 1 }` | a user's Spaces |
| `documents` | `{ spaceId: 1 }` | document list per Space |
| `jobs` | `{ status: 1, createdAt: 1 }` | the worker's claim query |
| `artifacts` | `{ userId: 1, createdAt: -1 }` | artifact history |
| `requests` | `{ createdAt: -1 }`, `{ requestId: 1 }` | observability and `/stats` |
| `runs` | `{ createdAt: -1 }` | run log export |

GridFS buckets `uploads` and `files` get their default indexes automatically.

## 4. Verify before trusting it

Atlas Search indexes are **eventually consistent**. Creating one returns immediately; it becomes
queryable up to a couple of minutes later. This is the single most common source of "indexed but
finds nothing" in this assignment, and it is why the read-your-write probe is a Must.

- In the Atlas UI, each search index shows a status. Wait for **Active**, not just created.
- `/health` must report `vectorStore: "atlas-vector-search"` and a Mongo ping result.
- The worker marks a document `indexed` only after querying the vector index for a chunk it just
  wrote and getting it back. Retry with backoff; do not assume the first probe succeeds.

## 5. Local development without Atlas

`VECTOR_BACKEND=mongo-cosine-scan` scores cosine similarity in Node over a Space's chunks. Useful
offline, reasonable to about 5,000 chunks, and it gives no hybrid retrieval. `/health` must say
which backend is live so a grader is never misled. Recall cannot be graded on this path.
