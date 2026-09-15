import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// .env lives at the Lumina repo root (three up: src -> gateway -> backend -> Lumina).
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: resolve(root, ".env") });
