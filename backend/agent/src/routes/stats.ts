import { Router } from "express";
import { StatsResponse } from "@lumina/contract";
import { getDb } from "../db/mongo.js";
import { countToday } from "../dailyCap.js";

export const statsRouter = Router();

const IMAGE_DAILY_CAP = Number(process.env.IMAGE_DAILY_CAP) || 10;
const DEEP_DAILY_CAP = Number(process.env.DEEP_DAILY_CAP) || 5;

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Every number here is computed straight from the same `runs` collection that
// writeRunLog() populates on every request -- the same source ask.ts logs
// from at completion, so /stats.answers and /stats.costUsdToday reconcile
// with the agent's own log by construction, not by coincidence.
statsRouter.get("/stats", async (req, res) => {
  const db = await getDb();
  const since = startOfTodayUtc();
  const userId = String(req.headers["x-user-id"] || "anon");

  const runsToday = await db.collection("runs").find({ createdAt: { $gte: since } }).toArray();
  const requests = runsToday.length;
  const answers = runsToday.filter((r) => r.terminated === "done" || r.terminated === "cap").length;
  const cached = runsToday.filter((r) => r.searchCached).length;
  const searchCacheHitRatePct = requests ? Number(((cached / requests) * 100).toFixed(1)) : 0;

  const ttfts = runsToday
    .map((r) => r.ttftMs)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);
  const ttftP95Ms = ttfts.length ? ttfts[Math.min(ttfts.length - 1, Math.ceil(0.95 * ttfts.length) - 1)] : 0;

  const costUsdToday = Number(runsToday.reduce((sum, r) => sum + (r.costUsd || 0), 0).toFixed(6));
  const imagesToday = await db.collection("artifacts").countDocuments({
    kind: "image",
    createdAt: { $gte: since },
  });

  // Read from the same counter the cap reserves against, so what /stats reports
  // as spent is the number that will actually refuse the next request.
  const deepToday = await countToday("deepUsage", userId);

  res.json(
    StatsResponse.parse({
      requests,
      answers,
      searchCacheHitRatePct,
      ttftP95Ms,
      costUsdToday,
      imagesToday,
      imageDailyCap: IMAGE_DAILY_CAP,
      deepToday,
      deepDailyCap: DEEP_DAILY_CAP,
    }),
  );
});
