# backend/gateway/ : the software backend (:8787)

Express + TypeScript. The only thing the browser talks to. Holds **no provider keys**; the only
upstream it knows is `AGENT_URL`.

**Status: scaffold only.**

## Responsibilities

- CORS for the UI origin.
- `X-User-Id` required on every route except `/health` (`401` otherwise).
- `X-Request-Id`: reuse inbound, else generate; forward to the agent; log it.
- One `pino` JSON line per request: `method, route, status, ms, requestId, userId`.
- zod validation of every inbound body against `packages/contract/` (`400` on failure).
- Per-user rate limit (`429`).
- Proxy every route to the agent service with the same shapes.
- **SSE pass-through without buffering** on `/threads/:id/ask`: no `compression` on that route,
  `res.flushHeaders()`, flush after every write, `X-Accel-Buffering: no`.
- Serve `GET /evals/report.json` from `reports/` (or the agent), never hand-edited.
- Optionally serve a static UI build.

## Planned layout

```
backend/gateway/
  package.json
  tsconfig.json
  src/
    server.ts               app wiring, listen on GATEWAY_PORT
    middleware/
      requestId.ts          reuse or generate X-Request-Id
      auth.ts               401 without X-User-Id (skips /health)
      log.ts                pino per-request line
      validate.ts           zod body validation from packages/contract
      rateLimit.ts          per X-User-Id, 429
    routes/
      proxy.ts              generic forward to AGENT_URL
      ask.ts                SSE pass-through, compression disabled
      health.ts             nests the agent's /health under ai
      evals.ts              GET /evals/report.json
```

## Test in isolation

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8787/threads -d '{}'            # 401
curl -s -X POST localhost:8787/threads -H 'x-user-id: dev' | jq                              # 201 {threadId}
```
