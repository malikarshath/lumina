import type { Db } from "mongodb";
import { getDb } from "../db/mongo.js";
import { chunkText } from "../rag/chunk.js";
import { embed } from "../providers/openai.js";
import { searchDocuments } from "../rag/search.js";

const MAX_ATTEMPTS = 3;

// Poll the jobs collection and process queued jobs. Runs in-process (one worker),
// backed by the durable `jobs` collection — a crash mid-job leaves it re-runnable.
export function startWorker(intervalMs = 1500) {
  setInterval(() => {
    processNext().catch((e) => console.error("worker error:", e));
  }, intervalMs);
  console.log("jobs worker started");
}

async function processNext() {
  const db = await getDb();
  // Atomically claim the oldest queued job.
  const job = await db.collection("jobs").findOneAndUpdate(
    { status: "queued" },
    { $set: { status: "running", startedAt: new Date() } },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
  if (!job) return;

  try {
    if (job.kind === "ingest_document") await ingest(db, job);
    await db.collection("jobs").updateOne({ _id: job._id }, { $set: { status: "done", finishedAt: new Date() } });
  } catch (err) {
    const attempts = (job.attempts ?? 0) + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    await db.collection("jobs").updateOne(
      { _id: job._id },
      { $set: { status: dead ? "failed" : "queued", error: String(err), attempts } },
    );
    if (dead && job.docId) {
      await db.collection("documents").updateOne({ docId: job.docId }, { $set: { status: "failed", error: String(err) } });
    }
    console.error(`job ${job._id} failed (attempt ${attempts}):`, String(err));
  }
}

async function ingest(db: Db, job: any) {
  const { docId, spaceId } = job;
  const setStatus = (status: string, pct: number, extra: object = {}) =>
    db.collection("documents").updateOne({ docId }, { $set: { status, pct, ...extra } });

  await setStatus("parsing", 10);
  let text: string = job.text ?? "";
  if (job.mime === "application/pdf" && job.data) {
    const pdf = (await import("pdf-parse")).default;
    const parsed = await pdf(Buffer.from(job.data, "base64"));
    text = parsed.text;
  }

  const doc = await db.collection("documents").findOne({ docId });
  const title = doc?.title ?? "Untitled";
  const chunks = chunkText(text);

  await setStatus("embedding", 50);
  const vectors = await embed(chunks.map((c) => c.text));

  const now = new Date();
  await db.collection("chunks").deleteMany({ docId }); // idempotent re-ingest
  if (chunks.length) {
    await db.collection("chunks").insertMany(
      chunks.map((c, i) => ({
        docId,
        spaceId,
        title,
        text: c.text,
        locator: c.locator,
        embedding: vectors[i],
        n: i,
        createdAt: now,
      })),
    );
  }

  // Read-your-write probe: only mark indexed once the content is actually
  // searchable (Atlas vector index is eventually consistent).
  const probed = await probe(spaceId, chunks[0]?.text ?? "");
  await setStatus("indexed", 100, { chunks: chunks.length, probed });
}

async function probe(spaceId: string, sample: string): Promise<boolean> {
  if (!sample) return true;
  for (let i = 0; i < 10; i++) {
    try {
      const hits = await searchDocuments(spaceId, sample.slice(0, 200), 3);
      if (hits.length > 0) return true;
    } catch {
      // index may not be queryable yet; keep polling
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}
