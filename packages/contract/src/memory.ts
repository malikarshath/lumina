import { z } from "zod";
import { ThreadId } from "./primitives.js";

export const Memory = z.object({
    id: z.string(),
    text: z.string(),
    sourceThread: ThreadId,
    createdAt: z.string(),
});
export type Memory = z.infer<typeof Memory>;

export const MemoryListResponse = z.object({
    memories: z.array(Memory),
});
export type MemoryListResponse = z.infer<typeof MemoryListResponse>;