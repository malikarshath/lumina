import Anthropic from "@anthropic-ai/sdk";

// Reads ANTHROPIC_API_KEY from the environment automatically.
export const anthropic = new Anthropic();

// Pinned in .env / sla.json. Falls back to sonnet-5 if unset. This is the
// model that writes the answer the user reads, so it is the one to keep good.
export const LLM_MODEL = process.env.LLM_MODEL ?? "claude-sonnet-5";

/**
 * The model for the internal calls nobody reads: decomposing a question into
 * sub-questions, and deciding whether a message contains a durable fact.
 *
 * Both are structuring tasks with a fixed output shape, and both were being
 * billed at the answer model's latency -- the planner alone measured ~8s
 * against a 4s target, and it is deep search's first paint, so it is the wait
 * a user actually sees. Splitting the model here buys that back without
 * touching the quality of the prose anyone reads.
 */
export const UTILITY_MODEL = process.env.UTILITY_MODEL ?? "claude-haiku-4-5";

/**
 * `output_config.effort` for models that accept it, and nothing for those that
 * do not. Haiku rejects the parameter outright with
 * `400 invalid_request_error: This model does not support the effort
 * parameter`, so sending it unconditionally turns every planner call into a
 * 502 the moment the utility model is a small one -- which is exactly the
 * configuration it exists to enable.
 *
 * Spread into a request: `...effortLow(MODEL)`.
 */
export function effortLow(model: string): Record<string, unknown> {
  if (/haiku/i.test(model)) return {};
  return { output_config: { effort: "low" } };
}
