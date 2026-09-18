import type Anthropic from "@anthropic-ai/sdk";
import { getDb, isDbConfigured } from "../db/mongo.js";

// Turns to replay. Enough for "what about the second one?" to resolve, bounded
// because every turn is re-sent on every request: an unbounded thread would
// grow the prompt (and TTFT, and cost) without limit.
const MAX_TURNS = Number(process.env.THREAD_HISTORY_TURNS) || 6;
// Prior answers are replayed for reference, not re-served, so they are trimmed.
const MAX_ANSWER_CHARS = 1200;

/**
 * Replays earlier turns of a thread as alternating user/assistant messages.
 *
 * Without this a follow-up is a brand-new conversation: "who is its CEO?" has
 * no "it". Tool calls from prior turns are deliberately not replayed -- only
 * the question and the answer text -- so old sources can never be re-cited as
 * though they were retrieved in this request.
 */
export async function loadThreadHistory(threadId: string, userId: string): Promise<Anthropic.MessageParam[]> {
  if (!isDbConfigured()) return [];
  try {
    const db = await getDb();
    const prior = await db
      .collection("answers")
      .find({ threadId, userId })
      .sort({ createdAt: -1 })
      .limit(MAX_TURNS)
      .toArray();

    return prior
      .reverse()
      .flatMap((a): Anthropic.MessageParam[] => {
        const question = String(a.query ?? "").trim();
        const answer = String(a.text ?? "").trim();
        if (!question || !answer) return [];
        return [
          { role: "user", content: question },
          { role: "assistant", content: answer.slice(0, MAX_ANSWER_CHARS) },
        ];
      });
  } catch (err) {
    // History is an enhancement; losing it degrades a follow-up but must not
    // fail the request outright.
    console.error("failed to load thread history:", String(err));
    return [];
  }
}
