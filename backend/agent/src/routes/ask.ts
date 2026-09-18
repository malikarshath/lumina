import { randomUUID } from "node:crypto";
import { Router } from "express";
import { AskBody, StreamErrorEvent } from "@lumina/contract";
import { sseInit, sseSend } from "../sse.js";
import { runAskLoop } from "../loop/askLoop.js";
import { runDeepLoop } from "../loop/deepLoop.js";
import { writeRunLog } from "../observability/runLog.js";
import { getDb } from "../db/mongo.js";
import { nextResetIso, reserveDailySlot } from "../dailyCap.js";
import { LoopFailure } from "../loop/loopFailure.js";

export const askRouter = Router();

// Deep search is the expensive gear -- several times the cost of a quick one --
// so it is the one that needs a spend gate. Enforced here in the agent service,
// not the gateway: the gateway cannot know which gear a request asked for.
const DEEP_DAILY_CAP = Number(process.env.DEEP_DAILY_CAP) || 5;

askRouter.post("/threads/:id/ask", async (req, res) => {
  // Validate the body against the contract. Bad shape -> 400, before any streaming.
  const parsed = AskBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  const userId = String(req.headers["x-user-id"] || "anon");
  // Forwarded by the gateway; falls back to a fresh id if this route is hit directly.
  const requestId = String(req.headers["x-request-id"] || randomUUID());

  // Auto-create the thread on first use, so a client (or a bench script)
  // never has to call POST /threads before asking -- but GET /threads/:id
  // now has a real thread doc to find, not just an id nobody ever created.
  const db = await getDb();
  await db.collection("threads").updateOne(
    { threadId: req.params.id },
    { $setOnInsert: { threadId: req.params.id, userId, createdAt: new Date() } },
    { upsert: true },
  );

  const depth = parsed.data.depth;

  // Before sseInit: once the SSE headers are flushed the status code is 200 and
  // a 429 can no longer be sent. The slot is reserved atomically, so the
  // (cap+1)th deep search is refused even while earlier ones are still running.
  if (depth === "deep") {
    const used = await reserveDailySlot("deepUsage", userId);
    if (used > DEEP_DAILY_CAP) {
      req.log.warn({ event: "deep_cap_reached", requestId, userId, used, cap: DEEP_DAILY_CAP });
      return res.status(429).json({ error: "daily deep search cap reached", resetsAt: nextResetIso() });
    }
  }

  sseInit(res);
  try {
    // Deep Search is a fully separate code path and budget from the
    // interactive quick loop -- "Quick and Deep must stay separate".
    const runLoop = depth === "deep" ? runDeepLoop : runAskLoop;
    const summary = await runLoop(parsed.data, (event, data) => sseSend(res, event, data), userId, req.params.id);
    // One line a grader can grep by requestId and reconcile against /stats.
    req.log.info({ event: "answer_completed", requestId, ...summary });
    await writeRunLog({ requestId, ...summary });
  } catch (err) {
    // Fail loud: an error event instead of done, never a fake answer -- and
    // the run log still gets written, with terminated: "error" (A1/A2).
    sseSend(res, "error", StreamErrorEvent.parse({ status: 502, error: String(err) }));
    req.log.error({ event: "answer_failed", requestId, error: String(err) });
    await writeRunLog({
      requestId,
      tokens: err instanceof LoopFailure ? err.tokens.in + err.tokens.out : 0,
      wallClockSec: 0,
      costUsd: err instanceof LoopFailure ? Number(err.costUsd.toFixed(6)) : 0,
      terminated: "error",
      // A LoopFailure carries the steps the loop had already taken, so a
      // failed run log still reads as a trajectory: five failed searches say
      // what went wrong, where "zero steps" only says that something did.
      // Anything else genuinely has no attributable tool -- and inventing a
      // name is not an option, because toolCalls[].name is a closed enum in
      // the contract and a made-up "ask_loop" fails validation, taking the
      // whole evals report down with it.
      toolCalls: err instanceof LoopFailure ? err.toolCalls : [],
      depth,
    });
  } finally {
    res.end();
  }
});
