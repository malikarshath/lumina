import "./loadEnv.js"; // MUST be first: loads .env before any client reads a key
import { randomUUID } from "node:crypto";
import express from "express";
import { pinoHttp } from "pino-http";
import { HealthResponse } from "@lumina/contract";
import { askRouter } from "./routes/ask.js";
import { threadsRouter } from "./routes/threads.js";
import { spacesRouter } from "./routes/spaces.js";
import { memoryRouter } from "./routes/memory.js";
import { artifactsRouter } from "./routes/artifacts.js";
import { statsRouter } from "./routes/stats.js";
import { evalsRouter } from "./routes/evals.js";
import { dbStatus, isDbConfigured } from "./db/mongo.js";
import { startWorker } from "./worker/worker.js";

const app = express();
app.use(express.json());
app.use(
  pinoHttp({
    // The gateway mints/forwards X-Request-Id; make pino's own req.id the
    // same value, so one id greps out the same request in both services' logs.
    genReqId: (req, res) => {
      const rid = String(req.headers["x-request-id"] || randomUUID());
      res.setHeader("x-request-id", rid);
      return rid;
    },
  }),
);
app.use(askRouter);
app.use(threadsRouter);
app.use(spacesRouter);
app.use(memoryRouter);
app.use(artifactsRouter);
app.use(statsRouter);
app.use(evalsRouter);

app.get("/health", async (_req, res) => {
  // env vars are `string | undefined`; the contract requires strings,
  // so fall back to a literal when a var is unset.
  // The contract allows db: "ok" | "down" only, so an unconfigured URI reports
  // as "down" -- from a caller's point of view "no database configured" and
  // "database unreachable" have the same consequence, and inventing a third
  // value would fail HealthResponse.parse below.
  const db = (await dbStatus()) === "ok" ? "ok" : "down";

  const body = {
    // "degraded" is the honest word for "serving, but the database it needs
    // is not answering".
    status: db === "ok" ? "ok" : "degraded",
    model: process.env.LLM_MODEL ?? "unconfigured",
    searchProvider: process.env.SEARCH_PROVIDER ?? "unconfigured",
    vectorStore: process.env.VECTOR_BACKEND ?? "unconfigured",
    db,
    // This IS the agent service, so reporting its own liveness: reachable
    // enough to answer, and the gateway nests this object under `ai`.
    ai: { status: "ok" as const },
  };

  // Validate on the way OUT: the service can never return a shape that
  // violates the contract. Throws (-> 500) if we ever drift.
  res.json(HealthResponse.parse(body));
});

// Express 4 does not catch rejections from async handlers, so an unexpected
// throw inside any route becomes an unhandled rejection and Node exits --
// turning one bad row in one endpoint into a total outage. Log it loudly and
// stay up; "fail loud" means never inventing an answer, not taking the
// service down with the request that failed.
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION (request failed, service staying up):", reason);
});

// Terminal error handler: anything that reaches here is a bug, and the client
// gets the contract's error shape rather than Express's HTML default.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("unhandled route error:", err);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: err.message || "internal error" });
});

const port = Number(process.env.AGENT_PORT) || 8000;
app.listen(port, () => {
  console.log(`agent service on :${port}`);
  // In-process jobs worker: ingests uploaded documents from the jobs collection.
  if (isDbConfigured()) startWorker();
});
