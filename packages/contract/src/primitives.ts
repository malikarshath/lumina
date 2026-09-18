import { z } from "zod";

export const Mode = z.enum(["auto", "web", "docs", "deep"]);
export type Mode = z.infer<typeof Mode>;   // -> "auto" | "web" | "docs" | "deep"

export const ThreadId = z.string().regex(/^thr_/, "must start with thr_");
export type ThreadId = z.infer<typeof ThreadId>;

export const DocumentId = z.string().regex(/^doc_/, "must start with doc_");
export type DocumentId = z.infer<typeof DocumentId>;

export const ArtifactId = z.string().regex(/^art_/, "must start with art_");
export type ArtifactId = z.infer<typeof ArtifactId>;

export const SpaceId = z.string().regex(/^spc_/, "must start with spc_");
export type SpaceId = z.infer<typeof SpaceId>;

