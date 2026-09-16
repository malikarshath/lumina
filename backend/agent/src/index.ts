import "./loadEnv.js"; // MUST be first: loads .env before any client reads a key
import express from "express";
import { pinoHttp } from "pino-http";
import { HealthResponse } from "@lumina/contract";
import { askRouter } from "./routes/ask.js";
import { dbStatus } from "./db/mongo.js";

const app = express();
app.use(express.json());
app.use(pinoHttp()); // one structured JSON log line per request
app.use(askRouter);

app.get("/health", async (_req, res) => {
  // env vars are `string | undefined`; the contract requires strings,
  // so fall back to a literal when a var is unset.
  const body = {
    status: "ok",
    model: process.env.LLM_MODEL ?? "unconfigured",
    searchProvider: process.env.SEARCH_PROVIDER ?? "unconfigured",
    vectorStore: process.env.VECTOR_BACKEND ?? "unconfigured",
    db: await dbStatus(), // real ping: "ok" | "down" | "unconfigured"
    ai: { status: "unknown" }, // TODO: cheap provider ping
  };

  // Validate on the way OUT: the service can never return a shape that
  // violates the contract. Throws (-> 500) if we ever drift.
  res.json(HealthResponse.parse(body));
});

const port = Number(process.env.AGENT_PORT) || 8000;
app.listen(port, () => console.log(`agent service on :${port}`));
