import { Router } from "express";
import { randomUUID } from "node:crypto";
import { CreateArtifactRequest, CreateArtifactResponse, ArtifactStatusResponse } from "@lumina/contract";
import { getDb } from "../db/mongo.js";
import { downloadStream } from "../db/gridfs.js";

export const artifactsRouter = Router();

const IMAGE_DAILY_CAP = Number(process.env.IMAGE_DAILY_CAP) || 10;

const todayKey = () => new Date().toISOString().slice(0, 10); // UTC day
const nextResetIso = () => {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
};

// POST /artifacts { kind, threadId, answerId?, prompt? } -> 202 { artifactId, kind, status: "pending" }
// The ask loop never calls generate_image / make_presentation (R2) — this is the only door to them,
// and the actual work happens on the jobs worker, never in this request.
artifactsRouter.post("/artifacts", async (req, res) => {
  const parsed = CreateArtifactRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { kind, threadId, answerId, prompt } = parsed.data;
  const userId = String(req.headers["x-user-id"] || "anon");
  const db = await getDb();

  if (kind === "deck") {
    if (!answerId) return res.status(400).json({ error: "answerId required for kind=deck" });
    const answer = await db.collection("answers").findOne({ answerId, threadId });
    if (!answer) return res.status(404).json({ error: "unknown answer for this thread" });
  }

  if (kind === "image") {
    // Reserve today's slot atomically before any provider spend — the
    // (cap+1)th request must 429 even if earlier ones are still generating.
    const key = todayKey();
    const usage = await db.collection("imageUsage").findOneAndUpdate(
      { userId, day: key },
      { $inc: { count: 1 }, $setOnInsert: { userId, day: key } },
      { upsert: true, returnDocument: "after" },
    );
    if ((usage?.count ?? 1) > IMAGE_DAILY_CAP) {
      return res.status(429).json({ error: "daily image cap reached", resetsAt: nextResetIso() });
    }
  }

  const artifactId = "art_" + randomUUID().slice(0, 8);
  await db.collection("artifacts").insertOne({
    artifactId,
    kind,
    threadId,
    answerId,
    userId,
    status: "pending",
    createdAt: new Date(),
  });
  await db.collection("jobs").insertOne({
    kind: kind === "deck" ? "make_presentation" : "generate_image",
    artifactId,
    threadId,
    answerId,
    prompt,
    userId,
    status: "queued",
    attempts: 0,
    createdAt: new Date(),
  });

  res.status(202).json(CreateArtifactResponse.parse({ artifactId, kind, status: "pending" }));
});

// GET /artifacts/:id -> 200 { status, url?, outline?, promptUsed?, model?, costUsd?, error? }
artifactsRouter.get("/artifacts/:id", async (req, res) => {
  const db = await getDb();
  const art = await db.collection("artifacts").findOne({ artifactId: req.params.id });
  if (!art) return res.status(404).json({ error: "unknown artifact" });

  res.json(
    ArtifactStatusResponse.parse({
      status: art.status,
      url: art.status === "ready" ? `/artifacts/${art.artifactId}/file` : undefined,
      outline: art.outline,
      promptUsed: art.promptUsed,
      model: art.model,
      costUsd: art.costUsd,
      error: art.error,
    }),
  );
});

// GET /artifacts/:id/file -> the rendered .pptx or .png, streamed from GridFS
artifactsRouter.get("/artifacts/:id/file", async (req, res) => {
  const db = await getDb();
  const art = await db.collection("artifacts").findOne({ artifactId: req.params.id });
  if (!art) return res.status(404).json({ error: "unknown artifact" });
  if (art.status !== "ready" || !art.fileId) return res.status(404).json({ error: "artifact not ready" });

  res.setHeader(
    "Content-Type",
    art.kind === "deck"
      ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      : "image/png",
  );
  const stream = await downloadStream(art.fileId);
  stream.on("error", () => res.status(404).end());
  stream.pipe(res);
});
