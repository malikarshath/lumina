# benchmark/

| File | Status | Notes |
|---|---|---|
| `sla.json` | Provided (copied from `../../benchmark/sla.json`) | Declared targets, cost model, workload. **Do not loosen to pass.** Set `target` to the deployed gateway before the final run. Prices are placeholders; set Anthropic and OpenAI published rates before trusting dollar figures. |
| `bench.mjs` | TODO, staff-provided per PRD section 15 | Runs the workload through the gateway, reports latency percentiles, grounding, recall@5, cache hit rate, cost per answer and per artifact, and writes `reports/eval.json` with `citationGrounding`, `recallAt5`, `retrievalRate`, `errorRate`. Exits non-zero on any SLA miss. |

```bash
node benchmark/bench.mjs                 # full run, Gate 4
node benchmark/bench.mjs --smoke         # five queries, Gate 2
node benchmark/bench.mjs --json out.json
```

If the staff `bench.mjs` has not shipped when we reach step 8, write one here that reads `sla.json`
and `expectations.json` and produces the same report shape, then replace it when theirs arrives.
