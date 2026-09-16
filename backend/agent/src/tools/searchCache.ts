import { getDb, isDbConfigured } from "../db/mongo.js";
import type { WebResult } from "./webSearch.js";

const TTL_MS = (Number(process.env.SEARCH_CACHE_TTL_SEC) || 6 * 3600) * 1000;
const LRU_MAX = 200;

// Tier 1: in-process LRU (fast, per-instance). Tier 2: Mongo `cache` (shared,
// TTL-expired by the expiresAt index). A hit means no Tavily call and no cost.
const lru = new Map<string, { results: WebResult[]; at: number }>();

const norm = (q: string) => q.trim().toLowerCase();

export async function getCached(query: string): Promise<WebResult[] | null> {
  const key = norm(query);
  const local = lru.get(key);
  if (local && Date.now() - local.at < TTL_MS) return local.results;

  if (isDbConfigured()) {
    try {
      const db = await getDb();
      const row = await db.collection("cache").findOne({ key });
      if (row && row.expiresAt instanceof Date && row.expiresAt > new Date()) {
        lru.set(key, { results: row.results as WebResult[], at: Date.now() });
        return row.results as WebResult[];
      }
    } catch {
      // cache is best-effort; fall through to a live search
    }
  }
  return null;
}

export async function setCached(query: string, results: WebResult[]): Promise<void> {
  const key = norm(query);
  lru.set(key, { results, at: Date.now() });
  if (lru.size > LRU_MAX) {
    const oldest = lru.keys().next().value;
    if (oldest !== undefined) lru.delete(oldest);
  }
  if (isDbConfigured()) {
    try {
      const db = await getDb();
      await db.collection("cache").updateOne(
        { key },
        { $set: { key, results, expiresAt: new Date(Date.now() + TTL_MS) } },
        { upsert: true },
      );
    } catch {
      // best-effort
    }
  }
}
