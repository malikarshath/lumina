import "./loadEnv.js"; // load root .env first
import express from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8000";
// Hosts like Render/Fly inject PORT; fall back to GATEWAY_PORT, then 8787.
const PORT = Number(process.env.PORT || process.env.GATEWAY_PORT) || 8787;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(
  pinoHttp({
    // Reuse the inbound X-Request-Id or mint one, echo it, forward it to the
    // agent (the proxy carries whatever's on req.headers), and make it
    // pino's own req.id -- the same id then shows up in the agent's log too.
    genReqId: (req, res) => {
      const rid = (req.headers["x-request-id"] as string) || randomUUID();
      req.headers["x-request-id"] = rid;
      res.setHeader("x-request-id", rid);
      return rid;
    },
  }),
);

// Rate limit per user (falls back to IP if no user header yet).
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.headers["x-user-id"] as string) || req.ip || "anon",
  }),
);

// Identity gate: every route except /health requires X-User-Id.
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (!req.headers["x-user-id"]) {
    return res.status(401).json({ error: "missing X-User-Id" });
  }
  next();
});

// Forward everything to the agent service. The proxy streams responses,
// so SSE (trace/sources/token/done) passes straight through to the browser.
// NOTE: we never call express.json() here — that would consume the body and
// break proxying of POST requests. The agent validates the contract.
app.use(
  createProxyMiddleware({
    target: AGENT_URL,
    changeOrigin: true,
  }),
);

app.listen(PORT, () => console.log(`gateway on :${PORT} -> ${AGENT_URL}`));
