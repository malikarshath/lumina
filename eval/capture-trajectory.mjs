// Captures one full SSE trajectory against a running gateway and merges it
// into report.json's `trajectories.<phase>` field -- the raw material /evals
// needs to render "one successful and one failing trajectory in full, every
// step" (P1). Doesn't touch bench.mjs's own metrics.
//
// Usage: node eval/capture-trajectory.mjs <success|failure> "<query>" "<lesson>"
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const TARGET = process.env.TARGET || "http://localhost:8787";
const USER = process.env.USER_ID || "bench";

const [phase, query, lesson] = process.argv.slice(2);
if (!["success", "failure"].includes(phase) || !query || !lesson) {
  console.error('usage: node eval/capture-trajectory.mjs <success|failure> "<query>" "<lesson>"');
  process.exit(1);
}

async function captureAsk(q) {
  const res = await fetch(`${TARGET}/threads/eval-traj-${phase}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": USER },
    body: JSON.stringify({ query: q, mode: "web" }),
  });
  const events = [];
  let answerText = "";
  if (!res.ok || !res.body) {
    events.push({ event: "http_error", status: res.status });
    return { events, answerText };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
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
      if (event === "token") {
        answerText += parsed.text;
        continue; // fold token deltas into the answer text, don't log every one
      }
      events.push({ event, ...parsed });
    }
  }
  return { events, answerText };
}

console.log(`capturing ${phase.toUpperCase()} trajectory: "${query}" against ${TARGET}`);
const { events, answerText } = await captureAsk(query);
const ok = events.some((e) => e.event === "done");
console.log(ok ? "  -> completed with a done event" : "  -> ended without a done event (error or timeout)");

for (const p of [resolve(root, "reports/report.json"), resolve(root, "web/public/report.json")]) {
  let report = {};
  try {
    report = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    // no existing report yet -- fine, we're only adding trajectories to it
  }
  report.trajectories = { ...report.trajectories, [phase]: { query, lesson, events, answerText } };
  writeFileSync(p, JSON.stringify(report, null, 2));
  console.log(`wrote trajectories.${phase} into ${p}`);
}
