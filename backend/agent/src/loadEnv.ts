import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// The .env lives at the Lumina repo root (three levels up from this file:
// src -> agent -> backend -> Lumina). Load it before any module reads a key.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: resolve(root, ".env") });
