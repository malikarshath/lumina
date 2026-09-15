# quality/

The cohort quality kit. Staff-provided per PRD section 15 (a scrubbed copy promoted from the
cohort's private folder, open question 6). Not yet in the repo.

| File | Purpose |
|---|---|
| `check.mjs` | Reads `expectations.json` and every `runs/*.json`; asserts budgets (B1 tokens, B2 wall clock, B3 cost), trajectory rules (A1 errors surface, A2 honest termination, A3 thrash guard, R2 no artifact tools on the ask path), and contract sanity (C1). Arithmetic only, no model judges. |
| `rules.json` | Every rule with its id, one executable sentence, the real precedent that created it, and a self-check question. A1's precedent is the Live Translate silent-fallback bug. |
| `expectations.example.json` | The schema `expectations.json` at the workspace root follows. |

```bash
node quality/check.mjs .      # exit 0 pass, 1 warnings, 2 at least one error
```

Do not edit these files. The bonus (+5) is a **new** rule with a real precedent submitted to the
cohort's `rules.json`, not an edit to an existing one.
