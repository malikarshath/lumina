---
project: LUMINA
submission: stretch bonus — "a new rule submitted to the cohort rules.json"
found: 2026-09-18
---

# Proposed rule D1 — a deploy config is proven by deploying it

Hub note. Related: [[PROGRESS]] · [[BUILD-LOG]] · [[DEPLOY]]

> Submitted against `eval/rubric.json` → `stretch_bonus.new_rule_with_precedent`:
> *"one executable sentence, a real incident as precedent (date, what broke, what it cost),
> a self-check question."*
>
> `quality/rules.json` is a provided file and a red line, so this is a **proposal** to the
> cohort rules file, not an edit of it. The JSON below is ready to paste.

## Why the existing rules miss it

The fourteen rules in `quality/rules.json` grade the **running system**: its trajectories (A\*),
its tools (R\*), its evals (E\*), its budgets (B\*), and the humans reading it (P\*). Every one of
them assumes the app is up. None of them looks at the files that decide *whether it can come up
at all*.

That gap has a specific shape: a config file can be valid JSON, reviewed, committed, and still be
**rejected by the only consumer that matters**. Nothing in the kit catches it, because the kit
starts measuring after the deploy succeeds.

## The incident (2026-09-18)

Deploying the **provided, unmodified** `web/vercel.json` fails:

```
$ vercel deploy
Error: Invalid vercel.json - should NOT have additional property `_comment`. Please remove it.
```

The file as shipped is:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "_comment": "SPA rewrite so /evals is served by index.html instead of 404ing on a hard refresh. The grader opens /evals directly, so this matters.",
  "rewrites": [{ "source": "/((?!assets/).*)", "destination": "/index.html" }]
}
```

Vercel's schema validator rejects unknown top-level properties. `$schema` is allowed;
`_comment` is not. The irony is the payload: the rejected key is a comment explaining that the
rewrite exists so `/evals` does not 404 on a hard refresh, *"and the grader opens `/evals`
directly, so this matters."*

**What it cost.** The deploy is refused outright, so the rewrite never takes effect. Follow
`TECHNICAL.md`'s own instruction — `cd web && vercel --prod` — and you get a hard failure at the
last step of the assignment, on the one file nobody thinks to doubt because it came with the kit.
Recover by guessing that a *comment* is the problem, and the honest first instinct is the opposite:
that your build output or your project settings are wrong. Anyone deploying the provided UI hits
this; the cost is measured in the time spent debugging a file you did not write and had no reason
to suspect.

**Why review could not catch it.** The file is valid JSON, it is self-documenting, and the
convention it uses (`_`-prefixed keys as comments) is used *correctly elsewhere in this very kit* —
`scripts/indexes.json`, `benchmark/sla.json` and `expectations.json` all carry `_comment` or
`$comment` keys and all work, because the things that read them are our own scripts, which ignore
unknown keys. The habit is right nine times out of ten. It fails exactly once: at the boundary
where a third party validates the file.

## The rule

```json
{
  "id": "D1",
  "title": "A deploy config is proven by deploying it",
  "type": "deploy",
  "severity": "error",
  "rule": "Every configuration file consumed by a hosting provider (vercel.json, fly.toml, render.yaml, Dockerfile) must contain only properties that provider's schema accepts, and must have been accepted by that provider in a real deployment before the submission claims the app is deployed; explanatory prose belongs in a sibling README, never in an extra key.",
  "precedent": [
    "FDE Assignment 1, LUMINA (cohort 2026-03), 2026-09-18: the PROVIDED web/vercel.json shipped with a `_comment` key explaining its SPA rewrite. Vercel's schema validator rejects unknown top-level properties, so `vercel deploy` failed with 'should NOT have additional property `_comment`' and refused the deployment entirely. The rewrite it documented exists so that /evals does not 404 on a hard refresh -- the one page the grader opens directly -- so the failure took out the submission surface, not a detail. The file was valid JSON, had been reviewed, and used a comment convention that works correctly in scripts/indexes.json, benchmark/sla.json and expectations.json, because those are read by our own scripts, which ignore unknown keys. The convention only fails where a third party validates the file, which is precisely where nobody was checking."
  ],
  "selfCheck": "Name the last deployment that accepted this exact config file, by URL and date. If you can only say that you read it and it looked right, you have not checked it.",
  "params": {
    "configs": ["vercel.json", "fly.toml", "render.yaml", "Dockerfile", "docker-compose.yml"]
  }
}
```

## How to check it

Mechanically, for the Vercel case:

```bash
# Any top-level key outside Vercel's schema fails the deploy. $schema is the
# only "meta" key it accepts.
node -e '
  const c = require("./web/vercel.json");
  const bad = Object.keys(c).filter((k) => k.startsWith("_"));
  if (bad.length) { console.error("will be rejected by Vercel:", bad.join(", ")); process.exit(1); }
  console.log("no comment keys");
'
```

And the part a script cannot do: a real deployment URL, from a real deploy, with a date.

## Suggested fix for the kit

Move the explanation out of the payload — the rewrite is the thing that must survive, and the
comment is what kills it:

```jsonc
// web/vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [{ "source": "/((?!assets/).*)", "destination": "/index.html" }]
}
```

with the reasoning moved into `web/README.md`, where it cannot break a deploy.
