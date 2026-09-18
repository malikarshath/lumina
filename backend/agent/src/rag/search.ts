import type { Document } from "mongodb";
import { getDb } from "../db/mongo.js";
import { embed } from "../providers/openai.js";

export type DocHit = {
  docId: string;
  title: string;
  text: string;
  locator: { line?: number; page?: number; heading?: string };
  score: number;
};

const TOP_K = Number(process.env.RAG_TOP_K) || 8;
const MIN_SCORE = Number(process.env.RAG_MIN_SCORE) || 0.08;
// Reciprocal Rank Fusion's damping constant. 60 is the value from the original
// paper and the usual default; it keeps rank 1 from dominating so a chunk that
// both retrievers rank highly beats one that only vector search loved.
const RRF_K = Number(process.env.RAG_RRF_K) || 60;

const PROJECT = {
  _id: 0,
  docId: 1,
  title: 1,
  text: 1,
  locator: 1,
} as const;

/** Nearest neighbours by embedding. Space filter is inside the vector stage. */
async function vectorCandidates(spaceId: string, qvec: number[], limit: number): Promise<Document[]> {
  const db = await getDb();
  return db
    .collection("chunks")
    .aggregate([
      {
        $vectorSearch: {
          // Names come from scripts/indexes.json, the provided definition of
          // every index this app needs.
          index: "chunks_vector",
          path: "embedding",
          queryVector: qvec,
          numCandidates: Math.max(100, limit * 20),
          limit,
          // The space filter belongs INSIDE $vectorSearch. Filtering after the
          // fact means the vector stage spends its whole limit on the nearest
          // chunks globally, then discards the ones from other spaces -- so a
          // space whose chunks are not in the global top-N comes back empty
          // even when it holds the answer.
          filter: { spaceId: { $eq: spaceId } },
        },
      },
      { $project: { ...PROJECT, vectorScore: { $meta: "vectorSearchScore" } } },
    ])
    .toArray();
}

/**
 * BM25 keyword matches. This is what vector search is bad at: exact names,
 * error codes, version numbers and rare tokens, where "semantically similar"
 * is not the same as "contains the thing I asked about".
 */
async function textCandidates(spaceId: string, query: string, limit: number): Promise<Document[]> {
  const db = await getDb();
  return db
    .collection("chunks")
    .aggregate([
      {
        $search: {
          index: "chunks_text",
          compound: {
            must: [{ text: { query, path: "text" } }],
            filter: [{ equals: { path: "spaceId", value: spaceId } }],
          },
        },
      },
      { $limit: limit },
      { $project: { ...PROJECT, textScore: { $meta: "searchScore" } } },
    ])
    .toArray();
}

const keyOf = (d: Document) =>
  `${d.docId}#${d.locator?.page ?? ""}:${d.locator?.line ?? ""}:${d.locator?.heading ?? ""}`;

/**
 * Hybrid retrieval: vector + BM25, fused with Reciprocal Rank Fusion.
 *
 * RRF fuses by RANK, not by score, which is the point: a cosine similarity and
 * a BM25 relevance score are different units on different scales, so adding or
 * averaging them lets whichever retriever happens to produce bigger numbers
 * decide the ordering. Summing 1/(k+rank) needs no normalisation and no tuning
 * per corpus.
 *
 * If the text index is unavailable (still building, or a cluster without Atlas
 * Search) this degrades to vector-only rather than failing the query -- with a
 * warning, because silently halving your retrieval quality is exactly the kind
 * of thing that shows up later as an unexplained recall drop.
 */
export async function searchDocuments(
  spaceId: string,
  query: string,
  topK = TOP_K,
): Promise<DocHit[]> {
  const [qvec] = await embed([query]);
  // Fuse over a wider pool than we return: a chunk ranked 9th by vector and
  // 2nd by text should be able to win, and it cannot if we only keep 5 of each.
  const pool = Math.max(topK * 3, 20);

  const [vectorHits, textHits] = await Promise.all([
    vectorCandidates(spaceId, qvec, pool),
    textCandidates(spaceId, query, pool).catch((err) => {
      console.warn("BM25 leg unavailable, falling back to vector-only:", String(err));
      return [] as Document[];
    }),
  ]);

  const fused = new Map<string, { doc: Document; score: number; vectorScore: number }>();
  const add = (hits: Document[]) => {
    hits.forEach((doc, i) => {
      const key = keyOf(doc);
      const prior = fused.get(key);
      const contribution = 1 / (RRF_K + i + 1);
      if (prior) {
        prior.score += contribution;
        // Keep whichever leg knew the raw similarity, for the floor below.
        prior.vectorScore = Math.max(prior.vectorScore, Number(doc.vectorScore ?? 0));
      } else {
        fused.set(key, {
          doc,
          score: contribution,
          vectorScore: Number(doc.vectorScore ?? 0),
        });
      }
    });
  };
  add(vectorHits);
  add(textHits);

  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .filter((e) => {
      // A weak match is worse than no match: it invites a citation to a chunk
      // that does not answer the question. Only applied to chunks the vector
      // leg scored -- a BM25-only hit has no comparable similarity number, and
      // a strong keyword match on a rare term is usually worth keeping.
      if (e.vectorScore === 0) return true;
      return e.vectorScore >= MIN_SCORE;
    })
    .slice(0, topK)
    .map(({ doc, score }) => ({
      docId: doc.docId as string,
      title: doc.title as string,
      text: doc.text as string,
      locator: doc.locator as DocHit["locator"],
      score,
    }));
}
