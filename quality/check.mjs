#!/usr/bin/env node
// LUMINA's quality gate. Staff never shipped quality/check.mjs (still "Not
// yet in the repo" per quality/README.md), so built per PRD 15: reads
// expectations.json and every runs/*.json, asserts by arithmetic only --
// budgets (B1 tokens, B2 wall clock, B3 cost), trajectory rules (A1 errors
// surface, A2 honest termination, A3 thrash guard, R2 no artifact tools on
// the ask path), and contract sanity (C1). No model judges anywhere here.
//
// Usage: node quality/check.mjs .      # exit 0 pass, 1 warnings, 2 errors
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(process.cwd(), process.argv[2] || ".");
const findings = []; // { rule, severity: "error" | "warn", message }

function fail(rule, severity, message) {
  findings.push({ rule, severity, message });
}

// ---- Load expectations.json ------------------------------------------------
const expectationsPath = resolve(projectRoot, "expectations.json");
if (!existsSync(expectationsPath)) {
  console.error(`missing ${expectationsPath}`);
  process.exit(2);
}
const expectations = JSON.parse(readFileSync(expectationsPath, "utf8"));
const { budget, trajectory, eval: evalCfg } = expectations;

// ---- C1: contract / config sanity ------------------------------------------
for (const [key, val] of Object.entries(budget)) {
  if (!(typeof val === "number" && val > 0)) fail("C1", "error", `budget.${key} must be a positive number, got ${val}`);
}
for (const key of ["minCitationGrounding", "minRecallAt5", "minRetrievalRate", "maxErrorRate"]) {
  const val = evalCfg[key];
  if (!(typeof val === "number" && val >= 0 && val <= 1)) {
    fail("C1", "error", `eval.${key} must be in 0..1, got ${val}`);
  }
}
const goldPath = resolve(projectRoot, evalCfg.goldSetPath);
if (!existsSync(goldPath)) fail("C1", "error", `eval.goldSetPath does not exist: ${evalCfg.goldSetPath}`);

const required = new Set(trajectory.mustCallTools ?? []);
const forbidden = new Set(trajectory.mustNotCallTools ?? []);
for (const t of required) {
  if (forbidden.has(t)) fail("C1", "error", `tool "${t}" is both required and forbidden`);
}

// ---- Load runs/*.json -------------------------------------------------------
const runsDir = resolve(projectRoot, "runs");
const runFiles = existsSync(runsDir) ? readdirSync(runsDir).filter((f) => f.endsWith(".json")) : [];

if (runFiles.length === 0) {
  fail("RUN", "warn", "no runs/*.json found -- nothing to check yet (ask a few real questions, or npm run export:runs against a deployed instance)");
}

const maxConsecutive = trajectory.maxConsecutiveSameTool ?? 3;

for (const file of runFiles) {
  const label = file;
  let run;
  try {
    run = JSON.parse(readFileSync(resolve(runsDir, file), "utf8"));
  } catch (e) {
    fail("RUN", "error", `${label}: not valid JSON (${e})`);
    continue;
  }

  const toolCalls = Array.isArray(run.toolCalls) ? run.toolCalls : [];

  // A1: a failed tool call must carry a non-empty error.
  for (const [i, tc] of toolCalls.entries()) {
    if (tc.ok === false && !(typeof tc.error === "string" && tc.error.length > 0)) {
      fail("A1", "error", `${label}: toolCalls[${i}] (${tc.name}) is ok:false with no non-empty error`);
    }
  }

  // A2: honest termination -- must be set, and a run that hit the tool-call
  // cap must not be mislabeled "done".
  if (trajectory.mustTerminate && !["done", "cap", "error"].includes(run.terminated)) {
    fail("A2", "error", `${label}: terminated is missing or invalid (${run.terminated})`);
  }
  if (toolCalls.length >= budget.maxToolCalls && run.terminated === "done") {
    fail("A2", "error", `${label}: hit the ${budget.maxToolCalls}-tool-call cap but reported terminated: "done"`);
  }

  // A3: thrash guard -- no more than maxConsecutiveSameTool identical calls in a row.
  let streak = 1;
  for (let i = 1; i < toolCalls.length; i++) {
    streak = toolCalls[i].name === toolCalls[i - 1].name ? streak + 1 : 1;
    if (streak > maxConsecutive) {
      fail("A3", "error", `${label}: tool "${toolCalls[i].name}" called ${streak} times in a row (max ${maxConsecutive})`);
      break;
    }
  }

  // R2: the ask path never spends on artifacts.
  for (const t of toolCalls) {
    if (forbidden.has(t.name)) fail("R2", "error", `${label}: forbidden tool "${t.name}" called from the ask path`);
  }

  // B1/B2/B3: per-run budgets.
  if (typeof run.tokens === "number" && run.tokens > budget.maxTokensPerRun) {
    fail("B1", "error", `${label}: tokens ${run.tokens} > budget.maxTokensPerRun ${budget.maxTokensPerRun}`);
  }
  if (typeof run.wallClockSec === "number" && run.wallClockSec > budget.maxWallClockSec) {
    fail("B2", "error", `${label}: wallClockSec ${run.wallClockSec} > budget.maxWallClockSec ${budget.maxWallClockSec}`);
  }
  if (typeof run.costUsd === "number" && run.costUsd > budget.maxCostUsd) {
    fail("B3", "error", `${label}: costUsd ${run.costUsd} > budget.maxCostUsd ${budget.maxCostUsd}`);
  }
}

// ---- Report -----------------------------------------------------------------
const errors = findings.filter((f) => f.severity === "error");
const warnings = findings.filter((f) => f.severity === "warn");

console.log(`checked ${runFiles.length} run(s) against ${expectationsPath}\n`);
for (const f of findings) {
  console.log(`  ${f.severity === "error" ? "ERROR" : "WARN "}  [${f.rule}]  ${f.message}`);
}
if (findings.length === 0) console.log("  no findings.");

console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length > 0 ? 2 : warnings.length > 0 ? 1 : 0);
