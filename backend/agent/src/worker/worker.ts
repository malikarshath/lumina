import type { Db } from "mongodb";
import { getDb } from "../db/mongo.js";
import { chunkPages, chunkText } from "../rag/chunk.js";
import { parsePdfPages } from "../rag/parse.js";
import { downloadBuffer } from "../db/gridfs.js";
import { embed } from "../providers/openai.js";
import { searchDocuments } from "../rag/search.js";
import { makeDeck, makeImage } from "./artifacts.js";

const MAX_ATTEMPTS = 3;
// A job claimed longer ago than this with no outcome is assumed to belong to a
// worker that died holding it.
const STALE_CLAIM_MS = (Number(process.env.JOB_STALE_CLAIM_SEC) || 300) * 1000;

// Poll the jobs collection and process pending jobs. Runs in-process (one worker),
// backed by the durable `jobs` collection — a crash mid-job leaves it re-runnable.
export function startWorker(intervalMs = 1500) {
  setInterval(() => {
    processNext().catch((e) => console.error("worker error:", e));
  }, intervalMs);
  // The sweeper is what makes "crash-safe" true rather than aspirational: a
  // worker killed mid-job leaves its row `running` forever, and nothing else
  // will ever claim it, so the upload silently never finishes. Runs on its own
  // slower interval since it is recovery, not throughput.
  setInterval(() => {
    sweepStaleJobs().catch((e) => console.error("sweeper error:", e));
  }, Math.max(intervalMs * 10, 15_000));
  console.log("jobs worker started");
}

// Returns jobs whose claim has gone stale to `pending` so another worker picks
// them up. Attempts still count, so a job that reliably kills its worker ends
// up `failed` rather than looping forever.
export async function sweepStaleJobs(): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
  const stale = await db
    .collection("jobs")
    .find({ status: "running", claimedAt: { $lt: cutoff } })
    .toArray();

  let reclaimed = 0;
  for (const job of stale) {
    const attempts = (job.attempts ?? 0) + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    await db.collection("jobs").updateOne(
      { _id: job._id, status: "running" },
      {
        $set: {
          status: dead ? "failed" : "pending",
          attempts,
          error: `reclaimed by sweeper: claim went stale at ${job.claimedAt?.toISOString?.() ?? "unknown"}`,
        },
        $unset: { claimedAt: "", workerId: "" },
      },
    );
    if (dead && job.docId) {
      await db
        .collection("documents")
        .updateOne({ docId: job.docId }, { $set: { status: "failed", error: "ingest kept failing mid-job" } });
    }
    reclaimed++;
    console.warn(`sweeper returned job ${job._id} to ${dead ? "failed" : "pending"} (attempt ${attempts})`);
  }
  return reclaimed;
}

async function processNext() {
  const db = await getDb();
  // Atomically claim the oldest pending job. claimedAt is what the sweeper
  // reads to decide a claim has gone stale.
  const job = await db.collection("jobs").findOneAndUpdate(
    { status: "pending" },
    { $set: { status: "running", claimedAt: new Date(), startedAt: new Date() } },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
  if (!job) return;

  try {
    if (job.kind === "ingest_document") await ingest(db, job);
    else if (job.kind === "make_presentation") await makeDeck(db, job);
    else if (job.kind === "generate_image") await makeImage(db, job);
    await db
      .collection("jobs")
      .updateOne({ _id: job._id }, { $set: { status: "done", finishedAt: new Date() }, $unset: { claimedAt: "" } });
  } catch (err) {
    const attempts = (job.attempts ?? 0) + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    await db.collection("jobs").updateOne(
      { _id: job._id },
      { $set: { status: dead ? "failed" : "pending", error: String(err), attempts }, $unset: { claimedAt: "" } },
    );
    if (dead && job.docId) {
      await db.collection("documents").updateOne({ docId: job.docId }, { $set: { status: "failed", error: String(err) } });
    }
    // Failure never leaves an artifact half-written and marked ready (PRD 5.5/5.6).
    if (dead && job.artifactId) {
      await db.collection("artifacts").updateOne({ artifactId: job.artifactId }, { $set: { status: "failed", error: String(err) } });
    }
    console.error(`job ${job._id} failed (attempt ${attempts}):`, String(err));
  }
}

async function ingest(db: Db, job: any) {
  const { docId, spaceId } = job;
  const setStatus = (status: string, pct: number, extra: object = {}) =>
    db.collection("documents").updateOne({ docId }, { $set: { status, pct, ...extra } });

  await setStatus("parsing", 10);

  const doc = await db.collection("documents").findOne({ docId });
  const title = doc?.title ?? "Untitled";

  // The upload route stores the bytes in GridFS and the job carries the id, so
  // reading the file is the worker's problem and never the request's.
  const buffer = job.fileId
    ? await downloadBuffer(String(job.fileId), "uploads")
    : // Older jobs (enqueued before GridFS) still carry inline content.
      Buffer.from(job.data ? String(job.data) : String(job.text ?? ""), job.data ? "base64" : "utf8");

  // PDFs go through the page-aware parser so each chunk can cite `p. N`;
  // text and markdown keep a heading or line locator. Either way a chunk
  // never loses where in the document it came from.
  let chunks;
  let pages: number | undefined;
  if (job.mime === "application/pdf") {
    const parsedPages = await parsePdfPages(buffer);
    pages = parsedPages.length;
    chunks = chunkPages(parsedPages);
  } else {
    chunks = chunkText(buffer.toString("utf8"));
  }

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

  // Read-your-write probe: `indexed` must mean "a query can find this
  // document right now", so the probe result gates the status rather than
  // being recorded next to it. Atlas's vector index is eventually consistent,
  // so marking indexed on insert would advertise a document that search
  // cannot yet return.
  if (!chunks.length) {
    await setStatus("failed", 100, { chunks: 0, probed: false, error: "no text extracted from document" });
    throw new Error(`ingest produced no chunks for ${docId}`);
  }

  const probed = await probe(spaceId, docId, chunks[0].text);
  if (!probed) {
    await setStatus("failed", 100, {
      chunks: chunks.length,
      probed: false,
      error: "chunks written but not retrievable from the vector index",
    });
    throw new Error(`read-your-write probe failed for ${docId}`);
  }
  await setStatus("indexed", 100, { chunks: chunks.length, pages, probed: true });
}

// Polls until the vector index returns a chunk belonging to THIS document.
// Matching on docId matters: another document in the same space can satisfy a
// "did anything come back" check while our own chunks are still unindexed.
async function probe(spaceId: string, docId: string, sample: string): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    try {
      const hits = await searchDocuments(spaceId, sample.slice(0, 200), 5);
      if (hits.some((h) => h.docId === docId)) return true;
    } catch {
      // index may not be queryable yet; keep polling
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}
