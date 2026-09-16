import { Router } from "express";
import { listMemories, deleteMemory } from "../rag/memory.js";

export const memoryRouter = Router();

// GET /memory -> 200 { memories: [...] }
memoryRouter.get("/memory", async (req, res) => {
  const userId = String(req.headers["x-user-id"] || "");
  const memories = await listMemories(userId);
  res.json({ memories });
});

// DELETE /memory/:id -> 204
memoryRouter.delete("/memory/:id", async (req, res) => {
  const userId = String(req.headers["x-user-id"] || "");
  await deleteMemory(userId, req.params.id);
  res.status(204).end();
});
