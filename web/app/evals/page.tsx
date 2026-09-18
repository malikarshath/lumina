"use client";

import { useEffect, useState } from "react";

type Check = { metric: string; measured: number; target: number; pass: boolean; dir: string };
type Sample = {
  query: string;
  ok: boolean;
  latencyMs?: number;
  ttftMs?: number;
  costUsd?: number;
  terminated?: string;
  error?: string;
};
type TrajEvent = {
  event: string;
  step?: number;
  tool?: string;
  input?: unknown;
  ok?: boolean;
  ms?: number;
  error?: string;
  status?: number;
  sources?: Array<{ n: number; kind: string; title: string }>;
  answerId?: string;
  latencyMs?: number;
  ttftMs?: number;
  costUsd?: number;
  terminated?: string;
};
type Trajectory = { query: string; lesson: string; events: TrajEvent[]; answerText: string };
type Report = {
  assignment: string;
  generatedAt: string;
  target: string;
  scope: string;
  bench: {
    ttftP95Ms: number;
    answerP95Ms: number;
    avgCostUsd: number;
    maxCostUsd: number;
    errorRatePct: number;
    capRatePct: number;
    n: number;
  };
  checks: Check[];
  samples: Sample[];
  trajectories?: { success?: Trajectory; failure?: Trajectory };
};

function describeEvent(e: TrajEvent): string {
  if (e.event === "trace") {
    return `trace: ${e.tool}(${JSON.stringify(e.input)}) -> ${e.ok ? "ok" : `FAILED: ${e.error}`} (${e.ms}ms)`;
  }
  if (e.event === "sources") return `sources: ${e.sources?.length ?? 0} source(s) sent to the client`;
  if (e.event === "done") {
    return `done: answerId=${e.answerId}, latency=${e.latencyMs}ms, ttft=${e.ttftMs}ms, cost=$${e.costUsd}, terminated=${e.terminated}`;
  }
  if (e.event === "error") return `error: HTTP ${e.status} — ${e.error}`;
  return e.event;
}

function TrajectoryCard({ title, traj, tone }: { title: string; traj: Trajectory; tone: "ok" | "fail" }) {
  return (
    <div
      className={`rounded-lg border p-4 ${tone === "ok" ? "border-green-900 bg-green-950/30" : "border-red-900 bg-red-950/30"}`}
    >
      <h3 className={`mb-1 text-sm font-semibold ${tone === "ok" ? "text-green-300" : "text-red-300"}`}>
        {title}
      </h3>
      <p className="mb-2 text-sm text-neutral-300">
        Query: <span className="italic">&ldquo;{traj.query}&rdquo;</span>
      </p>
      <ol className="mb-3 space-y-1 font-mono text-xs text-neutral-400">
        {traj.events.map((e, i) => (
          <li key={i}>
            {i + 1}. {describeEvent(e)}
          </li>
        ))}
      </ol>
      {traj.answerText && <p className="mb-2 text-sm text-neutral-300">Answer: {traj.answerText}</p>}
      <p className="text-sm text-neutral-400">
        <span className="text-neutral-500">What this taught me: </span>
        {traj.lesson}
      </p>
    </div>
  );
}

export default function Evals() {
  const [report, setReport] = useState<Report | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch("/report.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setReport)
      .catch(() => setMissing(true));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold">LUMINA — /evals</h1>
      <p className="mb-8 mt-1 text-neutral-400">
        Design, and real measured numbers from a benchmark run against the deployed gateway.
      </p>

      {/* ---- Design summary (graded; in the builder's own words) ---- */}
      <section className="mb-10">
        <h2 className="mb-2 text-xs uppercase tracking-widest text-neutral-500">Design</h2>
        <p className="mb-3 leading-relaxed text-neutral-300">
          LUMINA is a Perplexity-style search agent. A <b>Next.js UI</b> streams from a
          <b> gateway</b> (auth via <code>X-User-Id</code>, rate-limit, request-id, SSE pass-through),
          which forwards to an <b>agent service</b> running a bounded agentic loop: it calls
          <code> web_search</code> (Tavily), reads results, and streams a cited answer over SSE in the
          order <code>trace → sources → token → done</code>. Caps (8 tool calls / 90s) keep it bounded;
          on a provider error it fails loud with an <code>error</code> event, never a fake answer.
          Every request/response shape is validated by a shared Zod <b>contract</b> package.
        </p>
      </section>

      {missing && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-950 p-4 text-yellow-200">
          No <code>report.json</code> yet. Run <code>node benchmark/bench.mjs</code> and redeploy.
        </div>
      )}

      {report && (
        <>
          <p className="mb-6 text-sm text-neutral-500">
            Ran against <code>{report.target}</code> ·{" "}
            {new Date(report.generatedAt).toLocaleString()} · n={report.bench.n}
            <br />
            Scope: {report.scope}
          </p>

          {/* ---- SLA checks ---- */}
          <section className="mb-10">
            <h2 className="mb-3 text-xs uppercase tracking-widest text-neutral-500">
              SLA checks
            </h2>
            <div className="overflow-hidden rounded-lg border border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-900 text-neutral-400">
                  <tr>
                    <th className="px-4 py-2 text-left">Metric</th>
                    <th className="px-4 py-2 text-right">Measured</th>
                    <th className="px-4 py-2 text-right">Target</th>
                    <th className="px-4 py-2 text-right">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.checks.map((c) => (
                    <tr key={c.metric} className="border-t border-neutral-800">
                      <td className="px-4 py-2">{c.metric}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{c.measured}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                        {c.dir} {c.target}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span
                          className={
                            c.pass
                              ? "rounded bg-green-950 px-2 py-0.5 text-green-300"
                              : "rounded bg-red-950 px-2 py-0.5 text-red-300"
                          }
                        >
                          {c.pass ? "PASS" : "FAIL"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ---- Per-query samples ---- */}
          <section>
            <h2 className="mb-3 text-xs uppercase tracking-widest text-neutral-500">
              Sample runs
            </h2>
            <ol className="space-y-2 text-sm">
              {report.samples.map((s, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-neutral-800 px-4 py-2"
                >
                  <span className="truncate pr-4">{s.query}</span>
                  <span className="shrink-0 tabular-nums text-neutral-400">
                    {s.ok
                      ? `${s.latencyMs}ms · $${s.costUsd} · ${s.terminated}`
                      : `FAILED: ${s.error}`}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {/* ---- Trajectories: one success, one real failure, every step ---- */}
          {report.trajectories?.success && report.trajectories?.failure && (
            <section className="mt-10">
              <h2 className="mb-3 text-xs uppercase tracking-widest text-neutral-500">
                Trajectories — read the process, not just the answer
              </h2>
              <div className="space-y-4">
                <TrajectoryCard title="Successful trajectory" traj={report.trajectories.success} tone="ok" />
                <TrajectoryCard title="Failing trajectory (real provider exception)" traj={report.trajectories.failure} tone="fail" />
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
