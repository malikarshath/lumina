# DESIGN.md: LUMINA system design

> **Write this before any code.** It is graded as the design section of the `/evals` page and must
> be in your own words (a red line in `eval/rubric.json`). A stranger should be able to read it and
> understand how LUMINA works without opening the code.
>
> Status: **Written.** All five sections and the appendix are filled in (2026-09-08).

## 1. Components

What are the moving parts? Name each one and say in one sentence what it is.

Prompts to think about: the browser UI, the gateway, the agent service, the jobs worker, MongoDB
Atlas (and which collections), the search provider, the LLM, the embedding model, the image model.
Draw the diagram (ASCII is fine).

```
Browser UI
This is where the end user interacts.

Gateway
this component used for the ratelimit, logs the request

Agent service
It is used for thinking, reasoning, calling the external epi, calling the database.

Jobs worker
A separate background loop (not in the request path). It watches the `jobs` collection in Mongo,
picks up queued jobs (PDF upload, deck, image), does the slow work, and updates the job status.
The `jobs` collection is the mailbox between the fast API and the slow worker; they never talk directly.

MongoDB Atlas
It is used for the storing the data in nosql database. along GridFS in the MongoDB used for the files.

External APIs
This API is for calling the external APIs like (Anthropic SDK, OpenAI SDK, Tavily REST)
```

## 2. Responsibilities

For each component: what is it responsible for, and what is it explicitly NOT responsible for?

Prompts: why do provider keys live only in the agent service? Why does the gateway validate the
contract instead of the agent? Why does parsing a PDF never happen in the request path? Who
decides web vs. documents vs. both?

Component           Responsible for                             Not Responsible For

Browser UI          User interaction                             calling external api, Calling DB.
Gateway             Rate limit, Validate shapes(Zod)             Interating with user
                    check X-User-Id ·                            Calling the External API,
                    log every request · SSE pass-through.                  

Agent Service       calling DB, external service,               Direct interaction with user, 
                    Reasoning, Thinking                         storing the data to the database
                    
MongoDB Atlas       stores the data, database operations,       Interacts with user, Calling the External API
                    File chunk storage in GridFS
External APIs       Getting the output from the remote API      Interacting with user, Rate limit, log the  request

Why these boundaries:
- Provider keys live only in the agent service because a secret must never reach the browser, and
  the agent service is the least-exposed layer - nothing outside can reach it directly, and it is
  the only component that calls the paid providers (Anthropic, OpenAI, Tavily). Putting a key in the
  gateway would be wrong because the gateway is the internet-facing edge, the most exposed surface.
- The gateway validates the contract (not the agent) because it is the security wall: it stops bad
  requests before they reach the internals, so the agent service can trust what it receives.
- Parsing a PDF never happens in the request path because it is slow - a 60-page PDF would blow the
  <300ms 202 budget and leave the browser hanging. Slow work goes to the worker so the request
  returns fast; the worker updates the job row, and the gateway reads that status when the browser polls.

## 3. Communication

How do the parts talk? Protocols, direction, and what crosses each boundary.

Prompts: HTTP + SSE from browser to gateway; the same contract gateway to agent; `X-User-Id` and
`X-Request-Id` headers; the order `trace -> sources -> token -> done`; the `202`-then-poll pattern
for uploads and artifacts; the `jobs` collection as the channel between API and worker.

The gateway is always the front door. The browser only ever talks to the gateway, never to the
agent service or the worker directly. There are two kinds of flow:

Flow A - asking a question (fast, synchronous):
Browser --(HTTP + SSE, X-User-Id, X-Request-Id)--> Gateway --(same contract)--> Agent Service --> LLM / Tavily / Mongo
The agent service does the work live and streams events back through the gateway. The SSE events
always come in this order: trace -> sources -> token -> done. sources must arrive before the first
token, because the answer is grounded on those sources - you show what you found before you start
writing the answer from it.

Flow B - upload / deck / image (slow, asynchronous):
Browser --> Gateway --> Agent Service --writes a job--> jobs collection in Mongo, then returns 202 Accepted (<300ms).
The jobs worker loops over the jobs collection, picks up the queued job, does the slow work, and
updates the status. The browser polls (Browser --> Gateway --> reads job status in Mongo) until it
is indexed / done. The worker is never reachable from the browser - the jobs collection is the only
channel between the API and the worker.

## 4. State

Where does state live, who owns it, and how long does it last?

Prompts: thread history (messages), long-term memory (memories, per user, vector-indexed), document
chunks with locators, the two-tier search cache and its TTL, jobs and their status transitions,
artifacts and their files in GridFS, run logs. What is in-process only (the LRU)? What happens on a
crash mid-job?


there are different stats
Thread history lives in mongoDB, agent writes it and lives until deleted
Long term memory lives in the MongoDB, agent writes it and last per user
document chunks are in MongoDB + files are in GridFS, agent owns it, last until explicitly deleted.
search cache its TTL lives in Inprocess LRU and Mongo DB, Agent claims it. TTL last for 6 hours.
artifacts and their files live in GridFS, worker claims is.  last until explicitly deleted.

jobs live in the `jobs` collection in Mongo (queued -> running -> done/failed). The worker owns the
status transitions. Because the status is stored in Mongo (durable) and not in the worker's memory,
a crash mid-job does not lose the work: on restart the worker finds the unfinished job and can retry
it up to a max number of attempts. If it were only in memory, the upload would be silently dropped.

run logs: one JSON line per request (gateway) and per answer (agent), written to `runs/` for evidence.

## 5. Trade-offs

What did you choose, what did you give up, and why is that the right call for a two-week build?

Prompts: one Atlas cluster with vectors inside vs. a dedicated vector store. In-process worker
backed by `jobs` vs. Redis/broker. Fetching full pages vs. snippet-only. Hard caps (8 calls, 90 s)
vs. letting the loop run. Tavily vs. SerpApi. Next.js UI on Vercel vs. the provided Vite UI.
Read-your-write probe cost vs. "upserted means searchable".

Vector store: we chose one Atlas cluster with vectors inside over a dedicated vector store (Pinecone/
Weaviate). We gave up peak query performance and vector-specific features at large scale (a purpose-built
store does one job and does it faster). For a two-week build that is right because it keeps infra simple -
one database for documents, memory, cache, jobs, GridFS and vectors, nothing extra to run - and at
LUMINA's scale the performance gap does not bite.

Job queue: we chose polling the jobs collection in Mongo over running Redis/a broker. We gave up
fast dispatch and built-in retry/backoff (polling has some lag between checks, and we hand-roll the
retry logic). For a two-week build that is right because there is one worker and low volume, so the
lag does not matter - and not running a second piece of infrastructure is worth more than the speed.

UI: we chose Next.js on Vercel over the provided Vite UI. We gave up the time savings of a ready-made,
contract-correct UI (building our own is real extra work in a two-week window). It is still the right
call because Next.js on Vercel makes the required /evals page and the deploy trivial, gives one
framework end to end, and full control over how sources and streaming render - and the UI work is
bounded, so the cost is acceptable.

Tavily vs SerpApi: we chose Tavily over SerpApi. We gave up raw SERP data and broad multi-engine
coverage / fine-grained control over results. For a two-week build that is right because Tavily returns
clean, LLM-ready, relevance-ranked content - no parsing pipeline to build or maintain - which is exactly
what a grounded-answer product needs. SEARCH_PROVIDER leaves the door open to swap later.

Full-page fetch: we chose fetching full pages (for the results we actually cite) over snippet-only.
We gave up time and performance - more tokens to the LLM, higher latency and cost per answer. For a
two-week build that is right because grounding needs the real source text; a snippet can miss the
exact detail, and an ungrounded citation is a hard fail (grounded or nothing). Correctness beats speed here.

Hard caps: we chose hard caps (8 tool calls, 90s) over letting the loop run to completion. We gave up
occasionally cutting off an answer that might have gotten better with more calls. For a two-week build
that is right because it guarantees bounded cost (ties to max_cost_per_answer_usd) and bounded latency
(the user is never left staring at a spinner). When the cap is hit we return terminated: "cap" and a
marked partial answer - a marked partial answer is more honest than an unbounded wait.

Read-your-write probe: we chose to run the probe (a test search for the chunks we just inserted, and
only mark the job indexed once it comes back) over assuming upsert = searchable. We gave up a little
time and one extra query per upload. For a two-week build that is right because Atlas Vector Search
indexes asynchronously, so marking indexed too early would sometimes be a lie - the user would get an
empty result for a document that is actually there. A wrong "ready" is far worse than a half-second delay.
indexed only after the probe passes.

---

## Appendix: assumptions and open questions

Things you are treating as true but have not confirmed, and questions for the instructor.

Assumptions:
- Search provider = Tavily (chosen), swappable later via SEARCH_PROVIDER.
- Search cache TTL = 6 hours. This is my own choice, not a number given in the spec.
- Jobs retry up to a max number of attempts on crash - the exact max is a number I will pick, not given.
- Database must be MongoDB Atlas (M0), not local mongod, because vector search, the BM25 text index,
  and the read-your-write probe are Atlas-only features.

Open questions for the instructor:
- Does an Atlas M0 cluster exist yet / is one provisioned for this build?
- Is the 6-hour cache TTL acceptable, or is there a target hit rate that should drive it?
- Any constraint on max job retry attempts before a job is marked failed?
