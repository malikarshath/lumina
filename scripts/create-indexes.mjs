// Creates LUMINA's MongoDB collections + indexes on Atlas, including the
// Atlas Vector Search index (for embeddings) and a text search index (BM25,
// for hybrid retrieval). Idempotent-ish: "already exists" errors are ignored.
//
// Run:  node --env-file=.env scripts/create-indexes.mjs
import { MongoClient } from "mongodb";

const URI = process.env.MONGODB_URI;
const DB = process.env.MONGODB_DB || "lumina";
if (!URI) {
  console.error("MONGODB_URI is not set. Run with: node --env-file=.env scripts/create-indexes.mjs");
  process.exit(1);
}

const EMBED_DIMS = 1536; // OpenAI text-embedding-3-small

const client = new MongoClient(URI);

const ignoreExists = (label) => (err) => {
  if (/already exists|IndexAlreadyExists|Duplicate/i.test(String(err?.message))) {
    console.log(`  = ${label} (already exists)`);
  } else {
    throw err;
  }
};

try {
  await client.connect();
  await client.db(DB).command({ ping: 1 });
  console.log(`connected to Atlas, db="${DB}"\n`);
  const db = client.db(DB);

  // Ensure collections exist (createCollection is a no-op if present).
  for (const c of ["threads", "memories", "documents", "chunks", "jobs", "cache"]) {
    await db.createCollection(c).then(() => console.log(`+ collection ${c}`)).catch(() => {});
  }

  console.log("\nstandard indexes:");
  await db.collection("threads").createIndex({ userId: 1, createdAt: -1 }).then((n) => console.log(`  + threads.${n}`)).catch(ignoreExists("threads userId"));
  await db.collection("memories").createIndex({ userId: 1 }).then((n) => console.log(`  + memories.${n}`)).catch(ignoreExists("memories userId"));
  await db.collection("documents").createIndex({ spaceId: 1, status: 1 }).then((n) => console.log(`  + documents.${n}`)).catch(ignoreExists("documents spaceId"));
  await db.collection("chunks").createIndex({ docId: 1 }).then((n) => console.log(`  + chunks.${n}`)).catch(ignoreExists("chunks docId"));
  await db.collection("jobs").createIndex({ status: 1, createdAt: 1 }).then((n) => console.log(`  + jobs.${n}`)).catch(ignoreExists("jobs status"));
  // TTL index: cache entries expire automatically (search cache).
  await db.collection("cache").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).then((n) => console.log(`  + cache.${n} (TTL)`)).catch(ignoreExists("cache TTL"));

  console.log("\nAtlas Search indexes (build asynchronously; may take ~1-2 min to become queryable):");
  // Vector index for chunk embeddings.
  await db.collection("chunks").createSearchIndex({
    name: "vector_index",
    type: "vectorSearch",
    definition: {
      fields: [
        { type: "vector", path: "embedding", numDimensions: EMBED_DIMS, similarity: "cosine" },
        { type: "filter", path: "docId" },
      ],
    },
  }).then((n) => console.log(`  + chunks.${n} (vectorSearch)`)).catch(ignoreExists("chunks vector_index"));

  // NOTE: memory recall ranks with in-JS cosine similarity over stored embeddings
  // (per-user sets are small), so it needs no Atlas Search index — the M0 tier
  // caps the number of search indexes, and we spend them on chunks (vector + BM25).

  // Text (BM25) index for hybrid search.
  await db.collection("chunks").createSearchIndex({
    name: "text_index",
    type: "search",
    definition: { mappings: { dynamic: false, fields: { text: { type: "string" } } } },
  }).then((n) => console.log(`  + chunks.${n} (search/BM25)`)).catch(ignoreExists("chunks text_index"));

  console.log("\ndone.");
} catch (err) {
  console.error("\nFAILED:", err.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
