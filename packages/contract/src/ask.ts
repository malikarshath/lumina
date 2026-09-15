import { Mode, SpaceId } from "./primitives.js";
import { z } from "zod";
export const AskRequest = z.object({
  query: z.string().min(1),
  mode: Mode,
  spaceId: SpaceId.optional(),
});

export type AskRequest = z.infer<typeof AskRequest>;