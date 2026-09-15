# .claude/agents/

Subagent definitions for the LUMINA build. Each markdown file here *is* a subagent: its frontmatter
names it and lists its tools, its body is the system prompt. Claude Code loads them automatically.

Empty on purpose. Module 2 teaches subagents; add them here when the build calls for them.
Candidates that fit this project:

- `contract-checker.md`: reads `packages/contract/` and a route implementation, reports every mismatch in shape or status code. Read-only tools.
- `trajectory-reader.md`: reads one `runs/<requestId>.json` plus the matching pino lines and explains, step by step, why the answer cited what it cited. Read-only tools.
- `grounding-auditor.md`: for a sampled answer, checks every `[n]` against the fetched page or indexed chunk by normalized string match. Read-only tools.

Rules: a subagent never edits provided folders (`benchmark/`, `eval/`, `quality/`, `scripts/`,
`packages/contract/` once shipped) and never reads `.env`.
