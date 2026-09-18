import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { CreateSpaceResponse, ListSpacesResponse } from "@lumina/contract";
import { getDb } from "../db/mongo.js";
import { ObjectId, uploadBuffer } from "../db/gridfs.js";

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
  res.status(201).json(CreateSpaceResponse.parse({ spaceId, name }));
});

// GET /spaces -> 200 { spaces } for this user, newest first.
spacesRouter.get("/spaces", async (req, res) => {
  const db = await getDb();
  const rows = await db
    .collection("spaces")
    .find({ userId: req.headers["x-user-id"] })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  // Same reasoning as GET /threads: one legacy row must not 500 the list.
  const spaces: Array<{ spaceId: string; name: string; createdAt: string }> = [];
  let skipped = 0;
  for (const s of rows) {
    const candidate = {
      spaceId: s.spaceId as string,
      name: (s.name as string) ?? "Untitled",
      createdAt: new Date(s.createdAt ?? 0).toISOString(),
    };
    if (ListSpacesResponse.shape.spaces.element.safeParse(candidate).success) spaces.push(candidate);
    else skipped++;
  }
  if (skipped) console.warn(`GET /spaces: skipped ${skipped} row(s) that do not match the contract`);

  res.json(ListSpacesResponse.parse({ spaces }));
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

  // The bytes go to GridFS; the document row and the job carry only the id.
  // Base64-on-the-job-row was worse than slow: it inflates the payload by a
  // third and has to fit one BSON document, so a 25MB upload would exceed the
  // 16MB limit outright.
  //
  // The id is minted here rather than read back from the write, so the file
  // and the document row go out CONCURRENTLY. Every Atlas round trip on this
  // path is latency the client waits through before its 202, and the accept
  // budget is 300ms.
  const fileId = new ObjectId();
  await Promise.all([
    uploadBuffer(file.originalname, file.buffer, file.mimetype, "uploads", fileId),
    db.collection("documents").insertOne({
      docId,
      spaceId,
      userId: req.headers["x-user-id"],
      title: file.originalname,
      status: "pending",
      pct: 0,
      fileId: fileId.toString(),
      mime: file.mimetype,
      bytes: file.size,
      createdAt: new Date(),
    }),
  ]);

  // The job goes in LAST, deliberately. It is the signal that makes this
  // ingest claimable, and a worker that claimed it before the bytes finished
  // landing would fail on a file that was about to exist.
  await db.collection("jobs").insertOne({
    kind: "ingest_document",
    docId,
    spaceId,
    mime: file.mimetype,
    fileId: fileId.toString(),
    status: "pending",
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
