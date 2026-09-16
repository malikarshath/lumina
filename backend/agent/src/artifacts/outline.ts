import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, LLM_MODEL } from "../providers/anthropic.js";

type SourceForOutline = { n: number; kind: "web" | "doc"; title: string; url?: string };

export type Slide = { title: string; bullets: string[]; citations: number[]; notes?: string };
export type Outline = { title: string; slides: Slide[] };

const SYSTEM = `You turn a research answer and its numbered sources into a slide deck outline.
Output ONLY valid JSON (no markdown fences) matching exactly this shape:
{"title": string, "slides": [{"title": string, "bullets": string[], "citations": number[], "notes": string}]}
Produce 6 to 10 slides, 3-5 bullets each. Every number in "citations" MUST be one of the source
numbers given below — never invent a citation number that was not given to you.`;

// LLM call that turns an answer + its sources into a grounded slide outline.
// Citation numbers are re-checked against the real source list before this
// returns, so a hallucinated [n] can never reach the rendered deck.
export async function buildOutline(
  answerText: string,
  sources: SourceForOutline[],
): Promise<{ outline: Outline; inTok: number; outTok: number }> {
  const sourceList = sources
    .map((s) => `[${s.n}] ${s.title}${s.url ? ` — ${s.url}` : ""}`)
    .join("\n");

  const msg = await anthropic.messages.create({
    model: LLM_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [
      { role: "user", content: `Answer:\n${answerText}\n\nSources:\n${sourceList}` },
    ],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const raw = JSON.parse(cleaned) as Outline;

  const validNs = new Set(sources.map((s) => s.n));
  const outline: Outline = {
    title: raw.title,
    slides: raw.slides.map((s) => ({
      ...s,
      citations: (s.citations ?? []).filter((n) => validNs.has(n)),
    })),
  };

  return { outline, inTok: msg.usage?.input_tokens ?? 0, outTok: msg.usage?.output_tokens ?? 0 };
}
