import { GridFSBucket, ObjectId } from "mongodb";
import { getDb } from "./mongo.js";

// Rendered decks and images live in GridFS, next to everything else in the
// one Atlas cluster (per DECISIONS.md) — no S3, no second store.
async function getBucket(): Promise<GridFSBucket> {
  const db = await getDb();
  return new GridFSBucket(db, { bucketName: "artifacts" });
}

export async function uploadBuffer(
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const bucket = await getBucket();
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(filename, { contentType });
    stream.on("error", reject);
    stream.on("finish", () => resolve(stream.id.toString()));
    stream.end(buffer);
  });
}

export async function downloadStream(fileId: string) {
  const bucket = await getBucket();
  return bucket.openDownloadStream(new ObjectId(fileId));
}
