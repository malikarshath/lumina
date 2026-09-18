// Validates a running LUMINA gateway against the PROVIDED contract schemas.
//
// "shapes and status codes match packages/contract exactly" is a runtime claim,
// and a typecheck cannot make it: the backend can compile perfectly and still
// return the wrong shape. This asks the real server and parses every answer
// with the schema the provided UI compiles against.
import {
  CreateSpaceResponse,
  CreateThreadResponse,
  DoneEvent,
  GetThreadResponse,
  HealthResponse,
  ListDocumentsResponse,
  ListMemoryResponse,
  ListSpacesResponse,
  ListThreadsResponse,
  SourcesEvent,
  StatsResponse,
  TokenEvent,
  TraceEvent,
  UploadDocumentResponse,
} from "@lumina/contract";

const TARGET = process.argv[2] ?? "http://localhost:8787";
const USER = "conformance";
const H = { "x-user-id": USER };

let pass = 0;
const fails = [];
const ok = (name, detail = "") => {
  pass++;
  console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
};
const bad = (name, why) => {
  fails.push(name);
  console.log(`  FAIL ${name} — ${why}`);
};

/** Checks status code and, when a schema is given, that the body satisfies it. */
async function check(name, { method = "GET", path, body, headers = H, wantStatus, schema, isMultipart }) {
  try {
    const init = { method, headers: { ...headers } };
    if (body && !isMultipart) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    } else if (body) {
      init.body = body;
    }
    const res = await fetch(`${TARGET}${path}`, init);
    if (wantStatus !== undefined && res.status !== wantStatus) {
      return bad(name, `status ${res.status}, wanted ${wantStatus}`);
    }
    if (!schema) return ok(name, `status ${res.status}`), undefined;
    const json = await res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return bad(name, `status ${res.status} but body fails the schema: ${parsed.error.issues[0].message} at ${parsed.error.issues[0].path.join(".")}`);
    }
    ok(name, `status ${res.status}, body valid`);
    return parsed.data;
  } catch (err) {
    bad(name, String(err));
  }
}

console.log(`\ncontract conformance against ${TARGET}\n`);

console.log("public routes");
await check("GET /health", { path: "/health", headers: {}, wantStatus: 200, schema: HealthResponse });
await check("GET /stats", { path: "/stats", wantStatus: 200, schema: StatsResponse });

console.log("\nauth gate");
await check("GET /memory without X-User-Id -> 401", { path: "/memory", headers: {}, wantStatus: 401 });
await check("GET /evals/report.json without X-User-Id is not 401", { path: "/evals/report.json", headers: {} });

console.log("\nthreads");
const thread = await check("POST /threads -> 201", {
  method: "POST",
  path: "/threads",
  body: { title: "conformance" },
  wantStatus: 201,
  schema: CreateThreadResponse,
});
await check("GET /threads -> 200", { path: "/threads", wantStatus: 200, schema: ListThreadsResponse });
if (thread) {
  await check("GET /threads/:id -> 200", { path: `/threads/${thread.threadId}`, wantStatus: 200, schema: GetThreadResponse });
}
await check("GET /threads/thr_nope -> 404", { path: "/threads/thr_nope", wantStatus: 404 });
await check("POST /threads/:id/ask with {} -> 400", { method: "POST", path: "/threads/thr_x/ask", body: {}, wantStatus: 400 });

console.log("\nmemory");
await check("GET /memory -> 200", { path: "/memory", wantStatus: 200, schema: ListMemoryResponse });
await check("DELETE /memory/:id -> 204", { method: "DELETE", path: "/memory/does-not-exist", wantStatus: 204 });

console.log("\nspaces & documents");
const space = await check("POST /spaces -> 201", {
  method: "POST",
  path: "/spaces",
  body: { name: "conformance" },
  wantStatus: 201,
  schema: CreateSpaceResponse,
});
await check("GET /spaces -> 200", { path: "/spaces", wantStatus: 200, schema: ListSpacesResponse });
if (space) {
  const fd = new FormData();
  fd.append("file", new Blob(["# Conformance\n\nThe zebra constant is 4417.\n"], { type: "text/markdown" }), "conformance.md");
  await check("POST /spaces/:id/documents -> 202", {
    method: "POST",
    path: `/spaces/${space.spaceId}/documents`,
    body: fd,
    isMultipart: true,
    wantStatus: 202,
    schema: UploadDocumentResponse,
  });
  await check("GET /spaces/:id/documents -> 200", {
    path: `/spaces/${space.spaceId}/documents`,
    wantStatus: 200,
    schema: ListDocumentsResponse,
  });
}
await check("GET /spaces/spc_nope/documents -> 404", { path: "/spaces/spc_nope/documents", wantStatus: 404 });

console.log("\nSSE stream (quick)");
if (thread) {
  const res = await fetch(`${TARGET}/threads/${thread.threadId}/ask`, {
    method: "POST",
    headers: { ...H, "content-type": "application/json" },
    body: JSON.stringify({ query: "What is retrieval-augmented generation?", mode: "web" }),
  });
  const text = await res.text();
  const order = [];
  const schemaFor = { trace: TraceEvent, sources: SourcesEvent, token: TokenEvent, done: DoneEvent };
  let shapeErrors = 0;
  for (const frame of text.split("\n\n")) {
    let ev, data;
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) ev = line.slice(6).trim();
      else if (line.startsWith("data:")) data = line.slice(5).trim();
    }
    if (!ev || !data) continue;
    order.push(ev);
    const schema = schemaFor[ev];
    if (!schema) continue;
    const parsed = schema.safeParse(JSON.parse(data));
    if (!parsed.success) {
      shapeErrors++;
      if (shapeErrors === 1) bad(`SSE ${ev} payload`, `${parsed.error.issues[0].message} at ${parsed.error.issues[0].path.join(".")}`);
    }
  }
  if (!shapeErrors) ok("every SSE payload validates", `${order.length} frames`);
  const firstToken = order.indexOf("token");
  const sourcesAt = order.indexOf("sources");
  sourcesAt !== -1 && sourcesAt < firstToken
    ? ok("sources precedes the first token")
    : bad("sources precedes the first token", `order was ${[...new Set(order)].join(" -> ")}`);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(`failed: ${fails.join(", ")}`);
  process.exitCode = 1;
}
