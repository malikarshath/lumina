import { MongoClient, type Db } from "mongodb";

// A single shared client for the process. Connects lazily on first use.
let client: MongoClient | null = null;
let db: Db | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI);
}

export async function getDb(): Promise<Db> {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(process.env.MONGODB_DB || "lumina");
  return db;
}

// Cheap liveness check for /health: returns "ok" | "down" | "unconfigured".
export async function dbStatus(): Promise<"ok" | "down" | "unconfigured"> {
  if (!isDbConfigured()) return "unconfigured";
  try {
    const d = await getDb();
    await d.command({ ping: 1 });
    return "ok";
  } catch {
    return "down";
  }
}
