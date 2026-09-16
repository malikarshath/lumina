import { openai } from "../providers/openai.js";

const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-1";
const IMAGE_COST_USD = Number(process.env.IMAGE_COST_USD) || 0.04; // declared estimate, documented in .env.example

// 1x1 transparent PNG — used only when DRY_RUN=true, so the whole 202 -> ready
// -> file flow is provable without spending money or needing provider access.
const PLACEHOLDER_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export async function generateImage(
  prompt: string,
): Promise<{ buffer: Buffer; model: string; costUsd: number; promptUsed: string }> {
  if (process.env.DRY_RUN === "true") {
    return { buffer: Buffer.from(PLACEHOLDER_PNG_B64, "base64"), model: IMAGE_MODEL, costUsd: 0, promptUsed: prompt };
  }

  const res = await openai.images.generate({ model: IMAGE_MODEL, prompt, size: "1024x1024" });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("image provider returned no image data");

  return { buffer: Buffer.from(b64, "base64"), model: IMAGE_MODEL, costUsd: IMAGE_COST_USD, promptUsed: prompt };
}
