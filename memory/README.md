# memory/

Durable notes for the coding agent about *this build*: things learned the hard way that the code
does not explain and that should survive across Claude Code sessions.

This is **not** LUMINA's runtime memory. That lives in the `memories` collection in MongoDB and is
managed by `save_memory` / `recall_memory` / `GET /memory`.

One file per fact. Keep each short. Suggested naming: `YYYY-MM-DD-<slug>.md`.

Examples of what belongs here:

- "Express `compression` buffered SSE on the ask route; disabled it there and flush after every write."
- "Atlas M0: the `chunks` text index took ~90 s to become queryable after creation; the probe must retry."
- "Tavily `extract` returns empty content for PDFs behind a login; trace marks it `snippet-only`."

What does not belong here: anything already in `docs/DECISIONS.md`, `CLAUDE.md`, or git history.
