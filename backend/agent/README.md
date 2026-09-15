# backend/agent/ : the AI backend (:8000)

Express + TypeScript. The loop, its tools, memory, RAG, the jobs worker, artifacts, and run logs.
All provider keys live here and only here.

**Status: scaffold only.** Build this first, test with `curl -N`, then the gateway, then the UI.

## Planned layout

```
backend/agent/
  package.json
  tsconfig.json
  src/
    server.ts               app wiring, listen on AGENT_PORT, starts the worker (or `npm run worker` runs it separately)
    config.ts               every env var read once, typed, validated
    providers/
      llm.ts                Anthropic client behind one adapter: chat with tools, streaming, token + cost accounting
      embeddings.ts         OpenAI text-embedding-3-small
      images.ts             gpt-image-1, DRY_RUN placeholder path
      search/
        index.ts            picks tavily | serpapi from SEARCH_PROVIDER
        tavily.ts           search + extract
        serpapi.ts          search, then readability + jsdom fetch
    db/
      mongo.ts              client, database handle, collection accessors
      ids.ts                thr_ / ans_ / doc_ / art_ prefixed ids
      gridfs.ts             uploads and rendered files
    loop/
      run.ts                plan -> choose tool -> observe -> repeat -> answer; caps (8 calls, 90 s); terminated set at the call site
      router.ts             mode auto: web | docs | both, with a reason for the trace
      sse.ts                emit trace -> sources -> token -> done; error event on exception
      citations.ts          [n] to sources mapping and the grounding check
      runlog.ts             writes runs/<requestId>.json in the quality kit shape
    tools/
      webSearch.ts          two-tier cache: LRU + searchCache TTL collection, SHA-256(normalized query, provider)
      fetchPage.ts          full page text, marks snippet-only fallback in the trace
      searchDocuments.ts    $vectorSearch + $search fused with RRF, spaceId filter inside $vectorSearch
      recallMemory.ts       vector search over memories filtered by userId, capped
      saveMemory.ts         explicit writes only, for stable facts and preferences
    memory/
      threads.ts            threads + messages persistence
      longTerm.ts           memories collection, list + delete
    rag/
      parse.ts              pdfjs-dist page-aware; markdown by heading; text by line
      chunk.ts              chunks with locator {page | heading | line}
      index.ts              embed, upsert to chunks, read-your-write probe before indexed
      spaces.ts             spaces + documents collections, status + pct
    artifacts/
      deck.ts               answer + sources -> outline JSON -> pptxgenjs; slide citation check; Sources slide
      image.ts              prompt from thread context, daily cap per user (429 + resetsAt), cost logged
    worker/
      loop.ts               findOneAndUpdate claim, run job, flip status only on success
      sweeper.ts            stale running -> pending
      jobs.ts               kinds: index_document | make_deck | make_image
    routes/
      threads.ts  memory.ts  spaces.ts  artifacts.ts  health.ts  stats.ts
```

## Invariants (from ../../AGENTS.md)

- Ask-path tools: `web_search`, `fetch_page`, `search_documents`, `recall_memory`, `save_memory`. Never the artifact tools.
- `terminated` is `"done"`, `"cap"`, or `"error"`, set explicitly. No SDK gives it to you.
- A failed tool call carries `ok: false` and a non-empty `error`. A provider exception ends the run with `502`.
- Every answer writes `runs/<requestId>.json` and one pino line: `requestId, toolCalls, terminated, tokens, costUsd, searchCached, ttftMs, latencyMs`.
- `/health` names `model`, `searchProvider`, `vectorStore`, and Mongo status.

## Test in isolation

```bash
curl -s -X POST localhost:8000/threads -H 'x-user-id: dev' | tee /tmp/t.json
curl -N -X POST localhost:8000/threads/$(jq -r .threadId /tmp/t.json)/ask -H 'x-user-id: dev' \
  -H 'content-type: application/json' -d '{"query":"What is Tavily?","mode":"web"}'
```
