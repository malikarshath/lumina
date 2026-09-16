import type { Db } from "mongodb";
import { buildOutline } from "../artifacts/outline.js";
import { renderDeck } from "../artifacts/deck.js";
import { generateImage } from "../artifacts/image.js";
import { uploadBuffer } from "../db/gridfs.js";

// Same cost model as the ask loop (benchmark/sla.json cost_model) — a deck
// spends real LLM tokens on the outline call, so it gets logged the same way.
const LLM_IN_PER_M = 3.0;
const LLM_OUT_PER_M = 15.0;

export async function makeDeck(db: Db, job: any) {
  const { artifactId, answerId, threadId } = job;
  const answer = await db.collection("answers").findOne({ answerId, threadId });
  if (!answer) throw new Error(`answer ${answerId} not found for deck ${artifactId}`);

  const { outline, inTok, outTok } = await buildOutline(answer.text, answer.sources);
  const buffer = await renderDeck(outline, answer.sources);
  const fileId = await uploadBuffer(
    `${artifactId}.pptx`,
    buffer,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );

  const costUsd = (inTok / 1e6) * LLM_IN_PER_M + (outTok / 1e6) * LLM_OUT_PER_M;
  await db.collection("artifacts").updateOne(
    { artifactId },
    {
      $set: {
        status: "ready",
        outline,
        fileId,
        model: process.env.LLM_MODEL ?? "unconfigured",
        costUsd: Number(costUsd.toFixed(6)),
      },
    },
  );
}

export async function makeImage(db: Db, job: any) {
  const { artifactId, threadId, answerId, prompt } = job;
  let finalPrompt: string | undefined = prompt;
  if (!finalPrompt) {
    const answer = answerId ? await db.collection("answers").findOne({ answerId, threadId }) : null;
    finalPrompt = answer
      ? `An illustrative image for this research answer: ${answer.text.slice(0, 300)}`
      : "An illustrative image for a research answer.";
  }

  const { buffer, model, costUsd, promptUsed } = await generateImage(finalPrompt);
  const fileId = await uploadBuffer(`${artifactId}.png`, buffer, "image/png");

  await db.collection("artifacts").updateOne(
    { artifactId },
    { $set: { status: "ready", fileId, model, costUsd, promptUsed } },
  );
}
