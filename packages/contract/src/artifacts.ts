import { z } from "zod";
import { ThreadId, ArtifactId } from "./primitives.js";

export const ArtifactKind = z.enum([
  "deck", "image",
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const ArtifactStatus = z.enum([
  "pending", "ready", "failed"
]);
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

export const RateLimitError = z.object({
    error: z.string(),
    resetsAt: z.string(),
});
export type RateLimitError = z.infer<typeof RateLimitError>;


