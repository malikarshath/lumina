# eval/

| File | Status | Notes |
|---|---|---|
| `rubric.json` | Provided (copied from `../../eval/rubric.json`) | 100 points: 80 automated, 20 manual, red lines, stretch bonus. Read-only. |
| `eval.mjs` | TODO, staff-provided per PRD section 15 | Runs the six gates in order (STATIC, CONTRACT, RUN, TRAJECTORY, EVAL, HUMAN) and stops at the first failure. Exit codes: 0 pass, 1 warnings, 2 error. |
| `gold/rag_gold.jsonl` | TODO, staff-provided | 30 or more question/answer pairs over the gold corpus. Path is referenced by `expectations.json`. |
| `gold/corpus/` | TODO, staff-provided | 3 to 5 CC-licensed PDFs. Open question 8 in the PRD suggests arXiv RAG papers. |

The gold set is what `recallAt5 >= 0.70` is measured against. Until it ships, the Alex reference
app's `data/*.md` and its project-management PDF can stand in for local testing, but not for grading.
