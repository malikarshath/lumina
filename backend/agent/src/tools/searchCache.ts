import { createHash } from "node:crypto";
import { getDb, isDbConfigured } from "../db/mongo.js";
import type { WebResult } from "./webSearch.js";

// SEARCH_CACHE_TTL_SECONDS is the documented name in .env.example; the older
// SEARCH_CACHE_TTL_SEC is still read so an existing deployment keeps working.
const TTL_MS =
  (Number(process.env.SEARCH_CACHE_TTL_SECONDS || process.env.SEARCH_CACHE_TTL_SEC) || 6 * 3600) * 1000;
const LRU_MAX = 200;
const PROVIDER = process.env.SEARCH_PROVIDER ?? "tavily";

// Tier 1: in-process LRU (fast, per-instance). Tier 2: Mongo `searchCache`
// (shared, TTL-expired by the expiresAt index). A hit means no provider call
// and no cost.
const lru = new Map<string, { results: WebResult[]; at: number }>();

// The provider is part of the key, not just the query: Tavily and SerpApi
// return different result sets for the same words, so a cache keyed on the
// query alone would serve one provider's answers while claiming the other's.
const cacheKey = (query: string) =>
  createHash("sha256").update(`${query.trim().toLowerCase()}\u0000${PROVIDER}`).digest("hex");

export async function getCached(query: string): Promise<WebResult[] | null> {
  const key = cacheKey(query);
  const local = lru.get(key);
  if (local && Date.now() - local.at < TTL_MS) return local.results;

  if (isDbConfigured()) {
    try {
      const db = await getDb();
      const row = await db.collection("searchCache").findOne({ key });
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
  const key = cacheKey(query);
  lru.set(key, { results, at: Date.now() });
  if (lru.size > LRU_MAX) {
    const oldest = lru.keys().next().value;
    if (oldest !== undefined) lru.delete(oldest);
  }
  if (isDbConfigured()) {
    try {
      const db = await getDb();
      await db.collection("searchCache").updateOne(
        { key },
        { $set: { key, provider: PROVIDER, results, expiresAt: new Date(Date.now() + TTL_MS) } },
        { upsert: true },
      );
    } catch {
      // best-effort
    }
  }
}

// `searchCached` on the done event means EVERY search in the request was a hit,
// not merely one of them. Tracked as a counter pair rather than a boolean: an
// OR would report a request that paid for three of four searches as fully
// cached, which overstates the cache hit rate the SLA measures.
export class SearchCacheTally {
  private total = 0;
  private hits = 0;

  record(cached: boolean): void {
    this.total++;
    if (cached) this.hits++;
  }

  /** True only when at least one search ran and all of them hit. */
  get allCached(): boolean {
    return this.total > 0 && this.hits === this.total;
  }

  /** Searches that actually cost money. */
  get liveCalls(): number {
    return this.total - this.hits;
  }
}
