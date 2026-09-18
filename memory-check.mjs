// The memory Definition-of-Done, end to end, exactly as benchmark/bench.mjs
// asserts it (phase 4b):
//
//   1. ask thread A to remember a preference -> a row appears in GET /memory
//   2. ask thread B something unrelated      -> its trace carries recall_memory
//   3. DELETE the row                        -> GET /memory no longer lists it
//
// `--smoke` skips this phase, so it is easy to believe memory works because
// the routes exist. This asks the running server instead.
const TARGET = process.argv[2] ?? "http://localhost:8787";
const USER = `mem-check-${Date.now().toString(36)}`;
const H = { "x-user-id": USER, "content-type": "application/json" };
const PREF = "Always answer in British English and keep answers under 100 words.";

const j = async (method, path, body) => {
  const res = await fetch(`${TARGET}${path}`, {
    method,
    headers: H,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.status === 204 ? {} : res.json();
};

/** Reads an SSE answer and returns its trace plus text. */
async function ask(threadId, payload) {
  const res = await fetch(`${TARGET}/threads/${threadId}/ask`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  const out = { trace: [], text: "" };
  for (const frame of raw.split("\n\n")) {
    let ev, data;
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) ev = line.slice(6).trim();
      else if (line.startsWith("data:")) data = line.slice(5).trim();
    }
    if (!ev || !data) continue;
    try {
      const d = JSON.parse(data);
      if (ev === "trace") out.trace.push(d);
      else if (ev === "token") out.text += d.text ?? "";
    } catch {
      /* ignore a partial frame */
    }
  }
  return out;
}

const results = [];
const record = (name, passed, detail) => {
  results.push({ name, passed });
  console.log(`  ${passed ? "ok  " : "FAIL"} ${name} — ${detail}`);
};

console.log(`\nmemory cycle against ${TARGET} (user ${USER})\n`);

const before = await j("GET", "/memory");
const threadA = await j("POST", "/threads", {});
const a = await ask(threadA.threadId, {
  query: `Remember this preference for all future answers: ${PREF}`,
  mode: "web",
});
const saveStep = a.trace.filter((t) => t.tool === "save_memory" && t.ok);

const after = await j("GET", "/memory");
const added = (after.memories ?? []).filter((m) => !(before.memories ?? []).some((b) => b.id === m.id));
record(
  "memorySaved",
  added.length > 0,
  added.length
    ? `GET /memory lists ${added.length} new row${saveStep.length ? " and the trace shows save_memory" : " (but no save_memory step in the trace)"}`
    : "no new row in GET /memory after asking it to remember a preference",
);

if (added.length) {
  const threadB = await j("POST", "/threads", {});
  const b = await ask(threadB.threadId, { query: "What is the capital of Portugal?", mode: "web" });
  const recalled = b.trace.filter((t) => t.tool === "recall_memory");
  record(
    "memoryRecalled",
    recalled.length > 0 && recalled.some((t) => t.ok),
    recalled.length
      ? `a new thread's trace carries ${recalled.length} recall_memory step(s)`
      : "a new thread never called recall_memory — the preference cannot have crossed threads",
  );

  await fetch(`${TARGET}/memory/${added[0].id}`, { method: "DELETE", headers: H });
  const afterDelete = await j("GET", "/memory");
  const gone = !(afterDelete.memories ?? []).some((m) => m.id === added[0].id);
  record("memoryDeleted", gone, gone ? `DELETE /memory/${added[0].id} removed the row` : "the row survived its DELETE");

  // The DoD's actual wording: nothing is remembered that GET /memory does not
  // show. So the listing must account for every memory the user owns.
  const listedIds = new Set((afterDelete.memories ?? []).map((m) => m.id));
  const leaked = a.trace
    .filter((t) => t.tool === "save_memory" && t.ok)
    .map((t) => t.input?.text)
    .filter((text) => text && !(afterDelete.memories ?? []).some((m) => m.text === text) && added[0].text !== text);
  record(
    "nothing remembered that GET /memory hides",
    leaked.length === 0,
    leaked.length ? `${leaked.length} saved fact(s) not listed` : `${listedIds.size} row(s) listed, no hidden saves`,
  );
} else {
  record("memoryRecalled", false, "nothing was saved, so recall could not be tested");
  record("memoryDeleted", false, "nothing was saved, so delete could not be tested");
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
