# CLAUDE.md: LUMINA project instructions

You are the coding agent for **LUMINA**, Assignment 1 of the FDE Agent Engineering Bootcamp.
LUMINA is a Perplexity-style AI search engine: ask a question, get a streamed, cited answer built
from live web search and the user's own documents. It remembers the user across sessions. Any
answer can become a slide deck or an image on demand.

Read these before touching code, in this order:

1. [`../AGENTS.md`](../AGENTS.md): the non-negotiables. Do not relax or reinterpret them.
2. [`../PRD.md`](../PRD.md): the product. Section 7 is the fixed API contract, section 13 the quality bar.
3. [`../README.md`](../README.md): the build guide and self-verify commands.
4. [`docs/DESIGN.md`](docs/DESIGN.md): the learner's own answers to the five system-design questions.
   **If this file is still a template, stop and help the learner fill it in before writing any code.**
5. [`docs/DECISIONS.md`](docs/DECISIONS.md): stack choices already made for this build.

## Stack (decided, see docs/DECISIONS.md)

| Layer | Choice |
|---|---|
| UI | React via Next.js, Tailwind CSS, deployed on Vercel. Lives in `web/`. |
| Gateway (software backend) | Node 20 + Express + TypeScript, port 8787. Lives in `backend/gateway/`. |
| Agent service (AI backend) | Node 20 + Express + TypeScript, port 8000. Lives in `backend/agent/`. |
| LLM | Anthropic Claude API (text + reasoning + tool use). Key only in the agent service. |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims, fixed by the data model). |
| Images | OpenAI `gpt-image-1`, behind `POST /artifacts` and `IMAGE_DAILY_CAP`. `DRY_RUN` supported. |
| Database | MongoDB Atlas, one cluster: documents, memory, cache, jobs, GridFS, and vectors via Atlas Vector Search. |
| Search | Tavily by default, SerpApi via `SEARCH_PROVIDER` env swap. |

No user accounts, no OAuth, no payments. Identity is the `X-User-Id` header.

## Folder map

```
Lumina/
  CLAUDE.md              this file
  README.md              how to run, build order, self-verify
  .gitignore             .env, node_modules, web/.next, web/dist, runs/, reports/
  .env.example           every variable the services read, with placeholders
  package.json           npm workspaces root: npm run dev starts everything
  expectations.json      quality budgets, declared BEFORE the first run
  .claude/
    settings.json        permissions for this project
    agents/              subagent definitions (one .md each)
    commands/            slash commands (one .md each)
    skills/              skills, including the eval skill /fde-lumina-eval
  docs/
    DESIGN.md            five questions: components, responsibilities, communication, state, trade-offs
    DECISIONS.md         stack decisions with reasons
    API.md               the contract, restated for quick lookup (source of truth is ../PRD.md section 7)
    PROGRESS.md          hub note: phase, rubric tracker, six gates, SLA actuals, blockers
    BUILD-LOG.md         one dated entry per session: what I did, what I proved, what is next
  memory/                durable project notes for the coding agent (not runtime memory)
  scripts/               create-indexes.mjs and other one-off tooling
  web/                   Next.js + Tailwind UI
  backend/gateway/       Express gateway
  backend/agent/         Express agent service: loop, tools, memory, RAG, jobs worker, artifacts, run logs
  packages/contract/     zod schemas + TypeScript types for every route, SSE event, and collection
  benchmark/             sla.json (provided) + bench.mjs
  eval/                  rubric.json (provided), eval.mjs, gold/ (30-question RAG gold set + corpus)
  quality/               check.mjs + rules.json (quality kit)
  runs/                  one <requestId>.json per answer, git-ignored
  reports/               eval.json and report.json, git-ignored
```

## Rules for this repo

- **Contract first.** Every route, body, SSE event, and status code matches `packages/contract/`.
  `POST /threads/{id}/ask` streams `trace -> sources -> token -> done`, `sources` before the first `token`.
- **The ask loop never spends on artifacts.** Tools: `web_search`, `fetch_page`, `search_documents`,
  `recall_memory`, `save_memory`. `make_presentation` and `generate_image` exist only behind `POST /artifacts`.
- **Bounded and honest.** 8 tool calls, 90 s. Cap hit means `terminated: "cap"` and a marked partial answer.
  Provider exception means `terminated: "error"` and a `502`. Never a plausible answer on an exception.
- **Grounded or nothing.** A citation that does not resolve to something retrieved in that request is a fail.
  Empty retrieval says so and cites nothing.
- **Async is real.** Uploads and artifacts return `202` in under 300 ms. Work runs from the `jobs`
  collection. `indexed` only after the read-your-write probe.
- **Fail loud.** No `try/catch` that swallows a provider error. Every failed tool call has `ok: false`
  and a non-empty `error` string in the trace and the run log.
- **Secrets from env only.** Keys live in the agent service. Nothing is bundled into client JavaScript.
- **Evidence over vibes.** Numbers on `/evals` come from a real `bench.mjs` and `check.mjs` run against
  the deployed gateway. Never hand-edit `report.json`.
- **Provided folders are read-only once staff ship them:** `web/` (if provided), `packages/contract/`,
  `benchmark/`, `eval/`, `quality/`, `scripts/`. Until then, build them here following `../PRD.md` section 15.

## Working style

- Small steps, verified with `curl -N` before the UI. Build the agent service first, then the gateway, then the UI.
- Log one JSON line per request (gateway) and per answer (agent) with `pino`. One `X-Request-Id` end to end.
- Before claiming done, run the self-verify block in `README.md`. Inspection is not verification.

## Tracking (Obsidian vault)

These docs are notes in an Obsidian vault rooted at `/Users/arshath/Notes`, so they use
`[[wikilinks]]` and YAML frontmatter. Keep both true:

- **At the end of every session**, add a dated entry to `docs/BUILD-LOG.md` using the template at
  its foot. Fill the **Proved** section with commands actually run and what their output showed.
  If nothing was proved, write that.
- **When state changes**, update `docs/PROGRESS.md`: the phase table, the rubric tracker, the gate
  checkboxes, the SLA actuals, and the blockers table.
- Never write an SLA actual or a claimed rubric point that a real run did not produce. That is the
  same rule as `report.json`.
- New stack choices go in `docs/DECISIONS.md` as a new numbered entry, never as an edit to an old one.
