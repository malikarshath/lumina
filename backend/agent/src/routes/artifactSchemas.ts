import { z } from "zod";
import { ArtifactId, ThreadId } from "@lumina/contract";

/**
 * Artifact generation is NOT part of the graded contract -- SPEC.md §3 cut it,
 * and `packages/contract` (which must stay unedited) has no artifact routes.
 * These routes are kept as an extra, so their schemas live here rather than
 * being added to the provided contract package.
 */

export const ArtifactKind = z.enum(["deck", "image"]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const ArtifactStatus = z.enum(["pending", "ready", "failed"]);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

export const CreateArtifactRequest = z.object({
  kind: ArtifactKind,
  threadId: ThreadId,
  answerId: z.string().optional(),
  prompt: z.string().optional(),
});
export type CreateArtifactRequest = z.infer<typeof CreateArtifactRequest>;

export const CreateArtifactResponse = z.object({
  artifactId: ArtifactId,
  kind: ArtifactKind,
  status: z.literal("pending"),
});
export type CreateArtifactResponse = z.infer<typeof CreateArtifactResponse>;

export const ArtifactStatusResponse = z.object({
  status: ArtifactStatus,
  url: z.string().optional(),
  outline: z.unknown().optional(),
  promptUsed: z.string().optional(),
  model: z.string().optional(),
  costUsd: z.number().optional(),
  error: z.string().optional(),
});
export type ArtifactStatusResponse = z.infer<typeof ArtifactStatusResponse>;
