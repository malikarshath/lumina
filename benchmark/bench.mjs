// LUMINA benchmark: fires real web queries at a running gateway, reads the
// metrics from each `done` SSE event, aggregates, compares to sla.json, and
// writes report.json (for the /evals page). Numbers come from real runs only.
//
// Usage:
//   node benchmark/bench.mjs                       # target from sla.json (localhost:8787)
//   TARGET=https://lumina-fb9s.onrender.com node benchmark/bench.mjs   # deployed
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const sla = JSON.parse(readFileSync(resolve(here, "sla.json"), "utf8"));

const TARGET = process.env.TARGET || sla.target || "http://localhost:8787";
const USER = sla.user_id || "bench";

const QUERIES = [
  "What is the Model Context Protocol?",
  "Who founded Anthropic?",
  "What is Next.js used for?",
  "When was TypeScript first released?",
  "What is Retrieval-Augmented Generation?",
  "What is Vercel?",
];

function p95(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}
const avg = (n) => (n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0);

// Fire one ask, parse the SSE stream, return the metrics from `done` (or an error).
async function runOne(query) {
  const t0 = Date.now();
  const res = await fetch(`${TARGET}/threads/bench/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": USER },
    body: JSON.stringify({ query, mode: "web" }),
  });
  if (!res.ok || !res.body) {
    return { query, ok: false, error: `HTTP ${res.status}` };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = null;
  let error = null;
  let clientTtft = 0;
  while (true) {
    const { done: fin, value } = await reader.read();
    if (fin) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (event === "token" && !clientTtft) clientTtft = Date.now() - t0;
      if (event === "done") done = parsed;
      if (event === "error") error = parsed;
    }
  }
  if (error) return { query, ok: false, error: error.error ?? "error" };
  if (!done) return { query, ok: false, error: "no done event" };
  return {
    query,
    ok: true,
    ttftMs: done.ttftMs || clientTtft,
    latencyMs: done.latencyMs,
    costUsd: done.costUsd,
    terminated: done.terminated,
    tokens: done.tokens,
  };
}

console.log(`benchmarking ${TARGET} with ${QUERIES.length} web queries...\n`);
const samples = [];
for (const q of QUERIES) {
  process.stdout.write(`  • ${q} ... `);
  try {
    const r = await runOne(q);
    samples.push(r);
    console.log(r.ok ? `${r.latencyMs}ms, $${r.costUsd}` : `FAILED (${r.error})`);
  } catch (e) {
    samples.push({ query: q, ok: false, error: String(e) });
    console.log(`ERROR (${e})`);
  }
}

const ok = samples.filter((s) => s.ok);
const errors = samples.filter((s) => !s.ok);
const caps = ok.filter((s) => s.terminated === "cap");

const bench = {
  ttftP95Ms: p95(ok.map((s) => s.ttftMs)),
  answerP95Ms: p95(ok.map((s) => s.latencyMs)),
  avgCostUsd: Number(avg(ok.map((s) => s.costUsd)).toFixed(6)),
  maxCostUsd: Number(Math.max(0, ...ok.map((s) => s.costUsd)).toFixed(6)),
  errorRatePct: Number(((errors.length / samples.length) * 100).toFixed(1)),
  capRatePct: Number(((caps.length / Math.max(1, ok.length)) * 100).toFixed(1)),
  n: samples.length,
};

// Compare measured vs the declared SLA gates.
const checks = [
  { metric: "TTFT p95 (ms)", measured: bench.ttftP95Ms, target: sla.sla.ttft_p95_ms, pass: bench.ttftP95Ms <= sla.sla.ttft_p95_ms, dir: "<=" },
  { metric: "Answer p95 (ms)", measured: bench.answerP95Ms, target: sla.sla.answer_p95_ms, pass: bench.answerP95Ms <= sla.sla.answer_p95_ms, dir: "<=" },
  { metric: "Cost per answer ($)", measured: bench.maxCostUsd, target: sla.sla.max_cost_per_answer_usd, pass: bench.maxCostUsd <= sla.sla.max_cost_per_answer_usd, dir: "<=" },
  { metric: "Error rate (%)", measured: bench.errorRatePct, target: sla.sla.max_error_rate_pct, pass: bench.errorRatePct <= sla.sla.max_error_rate_pct, dir: "<=" },
];

const report = {
  assignment: "LUMINA",
  generatedAt: new Date().toISOString(),
  target: TARGET,
  scope: "web-search slice (docs/RAG, memory, artifacts not yet included)",
  bench,
  checks,
  samples,
};

for (const out of [resolve(root, "reports/report.json"), resolve(root, "web/public/report.json")]) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${out}`);
}

console.log("\n=== SLA checks ===");
for (const c of checks) {
  console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.metric}: ${c.measured} ${c.dir} ${c.target}`);
}
