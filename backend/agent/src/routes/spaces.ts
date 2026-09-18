import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/mongo.js";

export const spacesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB (contract)
});

// POST /spaces -> 201 { spaceId, name }
spacesRouter.post("/spaces", async (req, res) => {
  const db = await getDb();
  const spaceId = "spc_" + randomUUID().slice(0, 8);
  const name = (req.body?.name as string) || "My Space";
  await db.collection("spaces").insertOne({
    spaceId,
    name,
    userId: req.headers["x-user-id"],
    createdAt: new Date(),
  });
  res.status(201).json({ spaceId, name });
});

// Multer passes an error to the callback (rather than throwing) when the
// 25MB limit is exceeded; without this handler, Express's default error
// path returns a bare 500 instead of the contract's 413.
const uploadSingle = upload.single("file");
function handleUpload(req: Request, res: Response, next: NextFunction) {
  uploadSingle(req, res, (err: unknown) => {
    if (err && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file too large (25MB limit)" });
    }
    if (err) return res.status(400).json({ error: String(err) });
    next();
  });
}

// POST /spaces/:id/documents  (multipart 'file') -> 202 { docId, status: "pending" }
spacesRouter.post("/spaces/:id/documents", handleUpload, async (req, res) => {
  const db = await getDb();
  const spaceId = req.params.id;

  const space = await db.collection("spaces").findOne({ spaceId });
  if (!space) return res.status(404).json({ error: "unknown space" });

  const file = req.file;
  if (!file) return res.status(400).json({ error: "file required (multipart field 'file')" });

  const docId = "doc_" + randomUUID().slice(0, 8);
  const isPdf = file.mimetype === "application/pdf";

  await db.collection("documents").insertOne({
    docId,
    spaceId,
    title: file.originalname,
    status: "pending",
    pct: 0,
    createdAt: new Date(),
  });

  // Enqueue the slow work for the jobs worker (fast 202, no parsing in the request path).
  await db.collection("jobs").insertOne({
    kind: "ingest_document",
    docId,
    spaceId,
    mime: file.mimetype,
    text: isPdf ? undefined : file.buffer.toString("utf8"),
    data: isPdf ? file.buffer.toString("base64") : undefined,
    status: "queued",
    attempts: 0,
    createdAt: new Date(),
  });

  res.status(202).json({ docId, status: "pending" });
});

// GET /spaces/:id/documents -> 200 { documents: [...] } | 404 unknown space
spacesRouter.get("/spaces/:id/documents", async (req, res) => {
  const db = await getDb();
  const space = await db.collection("spaces").findOne({ spaceId: req.params.id });
  if (!space) return res.status(404).json({ error: "unknown space" });

  const documents = await db
    .collection("documents")
    .find({ spaceId: req.params.id })
    .project({ _id: 0, docId: 1, title: 1, status: 1, pct: 1, pages: 1, error: 1 })
    .toArray();
  res.json({ documents });
});
