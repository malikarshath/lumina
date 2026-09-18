import type { ToolCallLog } from "../observability/runLog.js";

/**
 * A loop that died part-way through, carrying what it had already done.
 *
 * Without this, a fatal error threw away the tool calls the loop had already
 * made, and the run log for a failed request listed no steps at all. That is
 * the wrong thing to lose: rule P1 asks a human to read a failing trajectory
 * end to end, and "terminated: error, zero steps" is not a trajectory -- it
 * says something broke without saying what was tried. The five failed
 * searches ARE the story.
 *
 * Synthetic tool names are deliberately not invented here either: the
 * contract's ToolName enum is closed, so a run log naming a "deep_loop" tool
 * fails validation and takes the whole evals report down with it.
 */
export class LoopFailure extends Error {
  constructor(
    message: string,
    readonly toolCalls: ToolCallLog[],
    readonly tokens: { in: number; out: number },
    readonly costUsd: number,
  ) {
    super(message);
    this.name = "LoopFailure";
  }
}
