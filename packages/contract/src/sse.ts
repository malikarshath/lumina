import { z } from "zod";
import { DocumentId } from "./primitives.js";

export const TokenEvent = z.object({
  event: z.literal("token"),
  text: z.string(),
});
export type TokenEvent = z.infer<typeof TokenEvent>;


export const TraceEvent = z.object({
  event: z.literal("trace"),
  step: z.number(),
  tool: z.string(),
  input: z.unknown(),
  ok: z.boolean(),
  ms: z.number(),
  reason:z.string().optional(),
  error: z.string().optional(),
});
export type TraceEvent = z.infer<typeof TraceEvent>;

const WebSource = z.object({
  n: z.number(),                    // citation number, e.g. [1]
  kind: z.literal("web"),
  title: z.string(),
  url: z.string().url(),            // .url() = must be a valid URL
  snippet: z.string(),
});

const DocSource = z.object({
    n: z.number(),
    kind: z.literal("doc"),
    title: z.string(),
    snippet: z.string(),
    docId: DocumentId,
    locator: z.object({
        page: z.number().optional(),
        heading: z.string().optional(),
        line: z.number().optional(),
    }),
});

const Source = z.discriminatedUnion("kind", [WebSource, DocSource]);

export const SourcesEvent = z.object({
  event: z.literal("sources"),
  sources: z.array(Source),
});
export type SourcesEvent = z.infer<typeof SourcesEvent>;

export const DoneEvent = z.object({
    event: z.literal("done"),
    answerId: z.string(),
    model: z.string(),
    latencyMs: z.number(),
    ttftMs: z.number(),
    costUsd: z.number(),
    searchCached: z.boolean(),
    tokens: z.object({
        in: z.number(),
        out: z.number(),
    }),
    terminated: z.enum(["done", "cap"]),
});
export type DoneEvent = z.infer<typeof DoneEvent>;

export const ErrorEvent = z.object({
    event: z.literal("error"),
    status: z.literal(502),
    error: z.string(),
});
export type ErrorEvent = z.infer<typeof ErrorEvent>;

export const AskEvent = z.discriminatedUnion("event", [
    TraceEvent,
    SourcesEvent,
    TokenEvent,
    DoneEvent,
    ErrorEvent,
]);
export type AskEvent = z.infer<typeof AskEvent>;
