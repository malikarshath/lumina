import { GridFSBucket, ObjectId } from "mongodb";
import { getDb } from "./mongo.js";

/**
 * Binary lives in GridFS, next to everything else in the one Atlas cluster
 * (per DECISIONS.md) -- no S3, no second store.
 *
 * Two buckets: `uploads` for documents a user sent us, `artifacts` for things
 * we rendered. Keeping them apart means a retention policy on one does not
 * touch the other.
 */
async function getBucket(bucketName: "uploads" | "artifacts"): Promise<GridFSBucket> {
  const db = await getDb();
  return new GridFSBucket(db, { bucketName });
}

export async function uploadBuffer(
  filename: string,
  buffer: Buffer,
  contentType: string,
  bucketName: "uploads" | "artifacts" = "artifacts",
  /**
   * Caller-chosen id. Letting the caller mint the id means it can write the
   * rows that reference this file at the same time as the file itself, instead
   * of waiting a full Atlas round trip to learn what the id turned out to be.
   */
  id: ObjectId = new ObjectId(),
): Promise<string> {
  const bucket = await getBucket(bucketName);
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStreamWithId(id, filename, { contentType });
    stream.on("error", reject);
    stream.on("finish", () => resolve(id.toString()));
    stream.end(buffer);
  });
}

export { ObjectId };

export async function downloadStream(fileId: string, bucketName: "uploads" | "artifacts" = "artifacts") {
  const bucket = await getBucket(bucketName);
  return bucket.openDownloadStream(new ObjectId(fileId));
}

/** Reads a whole GridFS file into memory. Used by the worker, never the request path. */
export async function downloadBuffer(
  fileId: string,
  bucketName: "uploads" | "artifacts" = "uploads",
): Promise<Buffer> {
  const stream = await downloadStream(fileId, bucketName);
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}
