import { getDb } from "../db/mongo.js";
import { embed } from "../providers/openai.js";

export type DocHit = {
  docId: string;
  title: string;
  text: string;
  locator: { line?: number; page?: number; heading?: string };
  score: number;
};

// Vector search over chunk embeddings, scoped to a space. (BM25/hybrid is a
// follow-up; Atlas vector search alone gives grounded document retrieval.)
export async function searchDocuments(
  spaceId: string,
  query: string,
  topK = 5,
): Promise<DocHit[]> {
  const db = await getDb();
  const [qvec] = await embed([query]);

  const rows = await db
    .collection("chunks")
    .aggregate([
      {
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: qvec,
          numCandidates: 100,
          limit: 50,
        },
      },
      { $match: { spaceId } },
      { $limit: topK },
      {
        $project: {
          _id: 0,
          docId: 1,
          title: 1,
          text: 1,
          locator: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ])
    .toArray();

  return rows as DocHit[];
}
