import { z } from "zod";
import { ThreadId } from "./primitives.js";

export const CreateThreadResponse = z.object({
    threadId: ThreadId,
});
export type CreateThreadResponse = z.infer<typeof CreateThreadResponse>;

export const Message = z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    sources: z.array(z.unknown()),
    artifacts: z.array(z.unknown()),
});
export type Message = z.infer<typeof Message>;

export const ThreadMessagesResponse = z.object({
    messages: z.array(Message),
});
export type ThreadMessagesResponse = z.infer<typeof ThreadMessagesResponse>;