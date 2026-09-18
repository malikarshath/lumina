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

// exposedHeaders is what lets browser JS actually read x-request-id off the
// response; without it CORS hides the header and a user cannot quote the id
// that would let us find their request in the logs.
app.use(cors({ origin: CORS_ORIGIN, exposedHeaders: ["x-request-id"] }));
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
    // route and userId are the two fields that make the log searchable when
    // one user reports one broken request.
    customProps: (req) => ({
      route: req.url?.split("?")[0],
      userId: (req.headers["x-user-id"] as string) || null,
    }),
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
    // Default express-rate-limit replies with a plain-text body; the contract
    // says every error is {error, ...}, and a client parsing JSON should not
    // have to special-case the one code it is most likely to hit.
    handler: (req, res) =>
      res.status(429).json({
        error: "rate limit exceeded: 60 requests per minute",
        resetsAt: new Date(Date.now() + 60_000).toISOString(),
      }),
  }),
);

// Public routes: /health for probes, /evals/report.json because the grader
// fetches the evidence report without credentials.
const PUBLIC_PATHS = new Set(["/health", "/evals/report.json"]);

// Identity gate: every other route requires X-User-Id.
app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
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
    on: {
      // Without this the proxy surfaces an unreachable agent as a socket hangup
      // and express answers 500 (or nothing at all, mid-SSE). 502 is the honest
      // code: the gateway is fine, the thing behind it is not.
      error: (err, _req, res) => {
        const target = res as import("node:http").ServerResponse;
        if (target.headersSent) return target.end();
        // Socket-level failures often carry an empty message and only a code.
        const detail = err.message || (err as NodeJS.ErrnoException).code || "no response";
        target.writeHead(502, { "Content-Type": "application/json" });
        target.end(JSON.stringify({ error: `upstream agent unavailable: ${detail}` }));
      },
    },
  }),
);

app.listen(PORT, () => console.log(`gateway on :${PORT} -> ${AGENT_URL}`));
