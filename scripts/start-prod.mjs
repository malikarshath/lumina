// Production launcher: starts the agent (:8000) and the gateway (:$PORT) in one
// process, so a single host (Render/Fly) can serve the whole backend.
// The gateway proxies to the agent on localhost. Env (keys, AGENT_URL, CORS_ORIGIN)
// comes from the host's environment settings.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const agentEnv = { ...process.env, AGENT_PORT: process.env.AGENT_PORT || "8000" };
// The gateway must talk to the agent on the same box, regardless of AGENT_URL.
const gatewayEnv = { ...process.env, AGENT_URL: `http://localhost:${agentEnv.AGENT_PORT}` };

function run(name, entry, env) {
  const child = spawn("node", [resolve(root, entry)], { env, stdio: "inherit" });
  child.on("exit", (code) => {
    console.error(`[${name}] exited with code ${code}; shutting down.`);
    process.exit(code ?? 1);
  });
  return child;
}

run("agent", "backend/agent/dist/index.js", agentEnv);
run("gateway", "backend/gateway/dist/index.js", gatewayEnv);
