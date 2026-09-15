# .claude/skills/

Skills for this project. Each skill is a folder with a `SKILL.md` (frontmatter: `name`,
`description`) plus optional reference files. Claude Code invokes a skill when a request matches
its description.

Empty on purpose. The one skill this assignment requires:

- `fde-lumina-eval/SKILL.md`: runs the six gates in order against a deployed gateway
  (`quality/check.mjs`, `benchmark/bench.mjs --smoke`, `check.mjs` over `runs/`, full `bench.mjs`,
  then the human gate), asks for the video link and the two trajectories read end to end, and
  writes `report.json` where the gateway serves it at `GET /evals/report.json`.

  The PRD lists this as "provided, to be built" by course staff. If it has not shipped when we
  reach step 9 of the build order, write it here following the previous cohort's
  `FDE-01-assignments/Assignment_1_Live_Translate/.claude/skills/fde-live-translate-eval/SKILL.md`
  as the pattern.
