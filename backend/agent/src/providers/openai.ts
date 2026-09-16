import OpenAI from "openai";

export const openai = new OpenAI(); // reads OPENAI_API_KEY
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

// Embed one or more texts -> 1536-dim vectors (matches the Atlas vector index).
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}
