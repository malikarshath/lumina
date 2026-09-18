import { randomUUID } from "node:crypto";
import { getDb } from "../db/mongo.js";
import { embed } from "../providers/openai.js";

export type Memory = {
  id: string;
  text: string;
  sourceThread?: string;
  createdAt: Date;
};

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function saveMemory(userId: string, text: string, sourceThread?: string): Promise<string> {
  const db = await getDb();
  const [embedding] = await embed([text]);
  const id = "mem_" + randomUUID().slice(0, 8);
  await db.collection("memories").insertOne({ id, userId, text, sourceThread, embedding, createdAt: new Date() });
  return id;
}

/**
 * Semantic recall over the user's long-term memories.
 *
 * Primary path is Atlas Vector Search on the provided `memories_vector` index,
 * filtered by `userId` inside the vector stage so one user's memories can
 * never rank into another's results. The in-JS cosine scan is kept only as a
 * fallback for a cluster with no Atlas Search (local `mongod`, or an index
 * still building) -- it is correct but reads every memory the user owns, which
 * stops scaling the moment a user has a few thousand.
 */
export async function recallMemory(userId: string, query: string, topK = 5): Promise<Memory[]> {
  const db = await getDb();
  const [qv] = await embed([query]);

  try {
    const hits = await db
      .collection("memories")
      .aggregate([
        {
          $vectorSearch: {
            index: "memories_vector",
            path: "embedding",
            queryVector: qv,
            numCandidates: Math.max(50, topK * 20),
            limit: topK,
            filter: { userId: { $eq: userId } },
          },
        },
        { $project: { _id: 0, id: 1, text: 1, sourceThread: 1, createdAt: 1 } },
      ])
      .toArray();
    if (hits.length > 0) return hits as Memory[];
  } catch {
    // Index missing or still building: fall through to the scan rather than
    // returning "no memories", which would look like the user never saved any.
  }

  return recallByScan(db, userId, qv, topK);
}

async function recallByScan(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  qv: number[],
  topK: number,
): Promise<Memory[]> {
  const rows = (await db.collection("memories").find({ userId }).toArray()) as any[];
  if (rows.length === 0) return [];
  return rows
    .map((r) => ({ r, score: cosine(qv, r.embedding as number[]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ r }) => ({ id: r.id, text: r.text, sourceThread: r.sourceThread, createdAt: r.createdAt }));
}

export async function listMemories(userId: string): Promise<Memory[]> {
  const db = await getDb();
  return (await db
    .collection("memories")
    .find({ userId })
    .project({ _id: 0, id: 1, text: 1, sourceThread: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .toArray()) as Memory[];
}

export async function deleteMemory(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.collection("memories").deleteOne({ userId, id });
  return r.deletedCount > 0;
}
