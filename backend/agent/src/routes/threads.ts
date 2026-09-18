import { Router } from "express";
import { randomUUID } from "node:crypto";
import { CreateThreadResponse, ThreadMessagesResponse } from "@lumina/contract";
import { getDb } from "../db/mongo.js";

export const threadsRouter = Router();

// POST /threads -> 201 { threadId }
threadsRouter.post("/threads", async (req, res) => {
  const db = await getDb();
  const threadId = "thr_" + randomUUID().slice(0, 8);
  await db.collection("threads").insertOne({
    threadId,
    userId: req.headers["x-user-id"],
    createdAt: new Date(),
  });
  res.status(201).json(CreateThreadResponse.parse({ threadId }));
});

// GET /threads/:id -> 200 { messages } | 404 unknown thread
threadsRouter.get("/threads/:id", async (req, res) => {
  const db = await getDb();
  const threadId = req.params.id;

  const thread = await db.collection("threads").findOne({ threadId });
  const answers = await db.collection("answers").find({ threadId }).sort({ createdAt: 1 }).toArray();
  // A thread "exists" if it was explicitly created, or has at least one
  // answer -- the ask route auto-creates the thread doc on first use, but an
  // id nobody has ever asked anything in is genuinely unknown.
  if (!thread && answers.length === 0) {
    return res.status(404).json({ error: "unknown thread" });
  }

  const messages = answers.flatMap((a) => [
    { role: "user" as const, content: a.query as string, sources: [], artifacts: [] },
    { role: "assistant" as const, content: a.text as string, sources: a.sources ?? [], artifacts: [] },
  ]);

  res.json(ThreadMessagesResponse.parse({ messages }));
});
