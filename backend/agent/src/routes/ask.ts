import { Router } from "express";
import { AskRequest } from "@lumina/contract";
import { sseInit, sseSend } from "../sse.js";
import { runAskLoop } from "../loop/askLoop.js";

export const askRouter = Router();

askRouter.post("/threads/:id/ask", async (req, res) => {
  // Validate the body against the contract. Bad shape -> 400, before any streaming.
  const parsed = AskRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  sseInit(res);
  try {
    await runAskLoop(parsed.data, (event, data) => sseSend(res, event, data));
  } catch (err) {
    // Fail loud: an error event instead of done, never a fake answer.
    sseSend(res, "error", { event: "error", status: 502, error: String(err) });
  } finally {
    res.end();
  }
});
