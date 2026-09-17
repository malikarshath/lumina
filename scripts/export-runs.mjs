// Dumps the durable `runs` Mongo collection into local runs/<requestId>.json
// files, in the exact PRD 13 shape. The agent's filesystem doesn't survive a
// redeploy on Render, so this is how quality/check.mjs gets something to read
// when grading against a live deployed instance instead of a local run.
import { MongoClient } from "mongodb";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const runsDir = resolve(root, "runs");

// Load .env the same way the services do, without adding a dotenv dependency here.
const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set (checked .env and the environment)");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "lumina");

const docs = await db.collection("runs").find({}).toArray();
mkdirSync(runsDir, { recursive: true });

let n = 0;
for (const d of docs) {
  const { tokens, wallClockSec, costUsd, terminated, toolCalls } = d;
  const body = { tokens, wallClockSec, costUsd, terminated, toolCalls };
  writeFileSync(resolve(runsDir, `${d.requestId}.json`), JSON.stringify(body, null, 2));
  n++;
}

console.log(`exported ${n} run log(s) to ${runsDir}`);
await client.close();
