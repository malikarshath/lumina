import Anthropic from "@anthropic-ai/sdk";

// Reads ANTHROPIC_API_KEY from the environment automatically.
export const anthropic = new Anthropic();

// Pinned in .env / sla.json. Falls back to sonnet-5 if unset.
export const LLM_MODEL = process.env.LLM_MODEL ?? "claude-sonnet-5";
