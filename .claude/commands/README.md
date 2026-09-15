# .claude/commands/

Slash commands for this project. Each markdown file becomes `/<filename>`; its body is the prompt
that runs when invoked.

Empty on purpose. Add commands as repeated workflows appear. Candidates:

- `verify.md`: run the self-verify block from `README.md` and report each line as pass or fail.
- `smoke.md`: `node benchmark/bench.mjs --smoke` (Gate 2) and summarize the five runs.
- `read-run.md <requestId>`: print `runs/<requestId>.json` and the matching gateway and agent log lines for that request id.
- `curl-ask.md "<question>"`: create a thread and stream one ask through the gateway with `curl -N`, so the SSE order can be eyeballed without the UI.
