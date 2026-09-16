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

// Per-user sets are small, so fetch the user's memories and rank in JS —
// no Atlas Search index needed (M0 caps those; we spend them on chunks).
export async function recallMemory(userId: string, query: string, topK = 5): Promise<Memory[]> {
  const db = await getDb();
  const rows = (await db.collection("memories").find({ userId }).toArray()) as any[];
  if (rows.length === 0) return [];
  const [qv] = await embed([query]);
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
