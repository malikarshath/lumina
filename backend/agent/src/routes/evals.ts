import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { getDb, isDbConfigured } from "../db/mongo.js";

export const evalsRouter = Router();

// Anchored to this file rather than process.cwd(), for the same reason the run
// logs are: the agent may be started from the repo root or from its own folder.
const here = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = process.env.EVAL_REPORT_PATH ?? resolve(here, "../../../../reports/report.json");

/**
 * The evidence report the grader fetches. Public by design -- the gateway
 * exempts this path from the X-User-Id gate -- so it must never carry anything
 * beyond eval results.
 *
 * Two rules pull in opposite directions here. Hygiene says `reports/` is
 * git-ignored; the evidence rule says the DEPLOYED gateway must serve this
 * file. Commit it and hygiene breaks; leave it out and a fresh deploy has
 * nothing to serve, which is what was happening (404 in production).
 *
 * The resolution: the report is generated locally by eval/build-report.mjs
 * against a real run, then PUBLISHED to Mongo by publish-report.mjs. Disk wins
 * when present, so local development keeps working; the deployment reads the
 * copy in the database. Nothing is committed and nothing is hand-written --
 * the numbers still come from one real bench run.
 */
evalsRouter.get("/evals/report.json", async (_req, res) => {
  try {
    const raw = await readFile(REPORT_PATH, "utf8");
    return res.type("application/json").send(raw);
  } catch {
    // No file here; fall through to the published copy.
  }

  if (isDbConfigured()) {
    try {
      const db = await getDb();
      const row = await db
        .collection("evalReports")
        .findOne({}, { sort: { publishedAt: -1 }, projection: { _id: 0, report: 1 } });
      if (row?.report) return res.type("application/json").json(row.report);
    } catch (err) {
      console.error("failed to read the published eval report:", String(err));
    }
  }

  // 404 rather than an empty report: "we have not run the eval yet" and "we
  // scored zero" are different claims and must not be made to look alike.
  res.status(404).json({
    error: "no eval report yet; run the bench, then `node eval/build-report.mjs` and `node publish-report.mjs`",
  });
});
