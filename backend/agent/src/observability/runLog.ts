import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getDb, isDbConfigured } from "../db/mongo.js";

// Anchored to this file's location, not process.cwd(), so it resolves to the
// same repo-root runs/ whether the agent is started from the repo root
// (start-prod.mjs) or from backend/agent directly (local `npm run dev`).
const here = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = process.env.RUNS_DIR ?? resolve(here, "../../../../runs");

export type ToolCallLog = { name: string; ok: boolean; error?: string };
export type RunLog = {
  requestId: string;
  tokens: number;
  wallClockSec: number;
  costUsd: number;
  terminated: "done" | "cap" | "error";
  toolCalls: ToolCallLog[];
  ttftMs?: number;
  searchCached?: boolean;
  answerId?: string;
};

// PRD 13's run-log shape, one file per request: runs/<requestId>.json --
// exactly {tokens, wallClockSec, costUsd, terminated, toolCalls}. A failed
// tool call must carry a non-empty error (A1) -- enforced by the caller, not
// here. Also written to a durable `runs` Mongo collection, with extra fields
// (ttftMs, searchCached, answerId) for /stats -- a deployed instance's
// filesystem doesn't survive a redeploy, so the file is exported back from
// Mongo by scripts/export-runs.mjs when grading against a live deployment.
export async function writeRunLog(log: RunLog): Promise<void> {
  try {
    mkdirSync(RUNS_DIR, { recursive: true });
    const { tokens, wallClockSec, costUsd, terminated, toolCalls } = log;
    const body = { tokens, wallClockSec, costUsd, terminated, toolCalls };
    writeFileSync(resolve(RUNS_DIR, `${log.requestId}.json`), JSON.stringify(body, null, 2));
  } catch (err) {
    console.error("failed to write local run log:", String(err));
  }

  if (isDbConfigured()) {
    try {
      const db = await getDb();
      await db.collection("runs").insertOne({ ...log, createdAt: new Date() });
    } catch (err) {
      console.error("failed to persist run log:", String(err));
    }
  }
}
