import { z } from "zod";
import { SpaceId, DocumentId } from "./primitives.js";

export const DocumentStatus = z.enum([
  "pending", "parsing", "embedding", "indexed", "failed",
]);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const CreateSpaceResponse = z.object({
  spaceId: SpaceId,
  name: z.string(),
});
export type CreateSpaceResponse = z.infer<typeof CreateSpaceResponse>;

export const UploadDocumentResponse = z.object({
  docId: DocumentId,
  status: z.literal("pending"),
});
export type UploadDocumentResponse = z.infer<typeof UploadDocumentResponse>;

export const Document = z.object({
  docId: DocumentId,
  title: z.string(),
  status: DocumentStatus,
  pct: z.number(),
  pages: z.number().optional(),
  error: z.string().optional(),
});
export type Document = z.infer<typeof Document>;

export const ListDocumentsResponse = z.object({
  documents: z.array(Document),
});
export type ListDocumentsResponse = z.infer<typeof ListDocumentsResponse>;
export * from "./documents.js";
