# packages/contract/ : the API contract as code

zod schemas and TypeScript types for every request, response, SSE event, and MongoDB collection
document in `../../../PRD.md` sections 7 and 8. The gateway validates inbound bodies with them, the
agent validates outbound events with them, and the UI imports the types.

**Status: scaffold only.** The PRD lists this package as staff-provided. Until it ships, build it
here from `docs/API.md`; if the staff version arrives, replace this folder with it and do not edit it.

## Planned layout

```
packages/contract/
  package.json              name: @lumina/contract
  tsconfig.json
  src/
    index.ts                re-exports everything
    headers.ts              X-User-Id, X-Request-Id
    threads.ts              POST /threads, GET /threads/:id, ask body (query, mode, spaceId)
    sse.ts                  trace, sources (web | doc discriminated union), token, done, error
    memory.ts               GET /memory, DELETE /memory/:id
    spaces.ts               spaces, documents, status enum, upload 202
    artifacts.ts            create body (kind deck | image), status, outline shape
    ops.ts                  health, stats, evals report
    errors.ts               error body + the status code enum (400 401 404 413 429 501 502)
    collections.ts          threads, messages, memories, spaces, documents, chunks, searchCache, jobs, artifacts, requests, runs
    runlog.ts               the runs/<requestId>.json shape the quality kit reads
```

Rule: zod is the source of truth. Mongoose, if used at all, is an implementation detail in the agent.
