import { Router } from "express";
import { randomUUID } from "node:crypto";
import { CreateThreadResponse, ListThreadsResponse, GetThreadResponse } from "@lumina/contract";
import { getDb } from "../db/mongo.js";

export const threadsRouter = Router();

// POST /threads -> 201 { threadId }
threadsRouter.post("/threads", async (req, res) => {
  const db = await getDb();
  const threadId = "thr_" + randomUUID().slice(0, 8);
  await db.collection("threads").insertOne({
    threadId,
    title: typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : "Untitled",
    userId: req.headers["x-user-id"],
    createdAt: new Date(),
  });
  res.status(201).json(CreateThreadResponse.parse({ threadId }));
});

// GET /threads -> 200 { threads } for this user, newest first.
// Declared before /threads/:id so "threads" is not read as an id.
threadsRouter.get("/threads", async (req, res) => {
  const db = await getDb();
  const rows = await db
    .collection("threads")
    .find({ userId: req.headers["x-user-id"] })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  // The ask route auto-creates a thread doc for whatever id is in the URL, and
  // the benchmark asks against ids like "bench-rag" that predate the thr_
  // prefix. Those rows are real, but they cannot satisfy the contract, and
  // validating the whole list at once would make one of them 500 the endpoint.
  const threads: Array<{ threadId: string; title: string; createdAt: string }> = [];
  let skipped = 0;
  for (const t of rows) {
    const candidate = {
      threadId: t.threadId as string,
      title: (t.title as string) ?? "Untitled",
      createdAt: new Date(t.createdAt ?? 0).toISOString(),
    };
    if (ListThreadsResponse.shape.threads.element.safeParse(candidate).success) threads.push(candidate);
    else skipped++;
  }
  if (skipped) console.warn(`GET /threads: skipped ${skipped} row(s) that do not match the contract`);

  res.json(ListThreadsResponse.parse({ threads }));
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

  res.json(GetThreadResponse.parse({ messages }));
});
