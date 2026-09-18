import { getDb } from "./db/mongo.js";

// Per-user, per-UTC-day spend gates, enforced here in the agent service (never
// in the gateway) because this is the only layer that knows what an operation
// costs. A documented cap that is not enforced server-side is not a cap.

export const todayKey = () => new Date().toISOString().slice(0, 10); // UTC day

export const nextResetIso = () => {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
};

// Reserves one slot atomically BEFORE any provider spend, so the (cap+1)th
// request is refused even while earlier ones are still running. Returns the
// count after this request's own increment.
export async function reserveDailySlot(collection: string, userId: string): Promise<number> {
  const db = await getDb();
  const day = todayKey();
  const usage = await db.collection(collection).findOneAndUpdate(
    { userId, day },
    { $inc: { count: 1 }, $setOnInsert: { userId, day } },
    { upsert: true, returnDocument: "after" },
  );
  return usage?.count ?? 1;
}

export async function countToday(collection: string, userId: string): Promise<number> {
  const db = await getDb();
  const usage = await db.collection(collection).findOne({ userId, day: todayKey() });
  return usage?.count ?? 0;
}
