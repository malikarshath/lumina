import { z } from "zod";

export const HealthResponse = z.object({
    status: z.string(),
    model: z.string(),
    searchProvider: z.string(),
    vectorStore: z.string(),
    db: z.string(),
    ai: z.object({ status: z.string() }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const StatsResponse = z.object({
    requests: z.number(),
    answers: z.number(),
    searchCacheHitRatePct: z.number(),
    ttftP95Ms: z.number(),
    costUsdToday: z.number(),
    imagesToday: z.number(),
    imageDailyCap: z.number(),
});
export type StatsResponse = z.infer<typeof StatsResponse>;

export const EvalReport = z.object({
    assignment: z.string(),
    student: z.string(),
    repo: z.string(),
    video: z.string(),
    deployedAt: z.string(),
    rubric: z.unknown(),
    bench: z.unknown(),
    quality: z.unknown(),
    trajectories: z.unknown(),
});
export type EvalReport = z.infer<typeof EvalReport>;