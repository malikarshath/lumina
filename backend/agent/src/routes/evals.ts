import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";

export const evalsRouter = Router();

// Anchored to this file rather than process.cwd(), for the same reason the run
// logs are: the agent may be started from the repo root or from its own folder.
const here = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = process.env.EVAL_REPORT_PATH ?? resolve(here, "../../../../reports/report.json");

// The evidence report the grader fetches. Public by design -- the gateway
// exempts this path from the X-User-Id gate -- so it must never carry anything
// beyond eval results; it is written by eval/eval.mjs against a real run, and
// is read straight off disk so a stale in-memory copy can't drift from it.
evalsRouter.get("/evals/report.json", async (_req, res) => {
  try {
    const raw = await readFile(REPORT_PATH, "utf8");
    res.type("application/json").send(raw);
  } catch {
    // 404 rather than an empty report: "we have not run the eval yet" and
    // "we scored zero" are different claims and must not look alike.
    res.status(404).json({ error: "no eval report yet; run `node eval/eval.mjs` to generate one" });
  }
});
