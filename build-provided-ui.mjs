// Builds the PROVIDED Vite UI against our gateway and stages it for Vercel.
//
// Why this exists: the provided web/ is the acceptance test ("PROVIDED -- this
// is the acceptance test. Do not edit it; make it light up."), and it lives in
// the instructor's scaffold, not in this repo. Our submission is our own
// Next.js UI (TECHNICAL.md lists that as a bonus), so this is the known-good
// fallback: the grader's own UI, unmodified, pointed at our backend.
//
// Usage:
//   node build-provided-ui.mjs                       # uses the deployed gateway
//   node build-provided-ui.mjs http://localhost:8787 # against a local one
//   cd provided-ui-dist && npx vercel deploy --prod
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// The instructor's scaffold is the parent of this repo folder.
const scaffold = resolve(here, "..");
const providedWeb = resolve(scaffold, "web");
const out = resolve(here, "provided-ui-dist");

const GATEWAY = process.argv[2] ?? "https://lumina-fb9s.onrender.com";

if (!existsSync(providedWeb)) {
  console.error(`No provided UI at ${providedWeb}.`);
  console.error("This script needs the instructor's scaffold checked out beside this repo.");
  process.exit(1);
}

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, VITE_API_URL: GATEWAY } });

console.log(`\nbuilding the provided UI against ${GATEWAY}\n`);

// The provided web/ imports @lumina/contract, whose dist/ is gitignored, so a
// fresh checkout has no type declarations and `vite build` fails on a
// "Cannot find module" before it ever reaches the bundler. Build it first.
if (!existsSync(resolve(scaffold, "node_modules"))) {
  console.log("installing scaffold deps (first run only)...");
  run("npm", ["install", "--silent"], scaffold);
}
run("npm", ["run", "build", "--workspace", "packages/contract"], scaffold);
run("npm", ["run", "build", "--workspace", "web"], scaffold);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(providedWeb, "dist"), out, { recursive: true });

// The provided vercel.json ships with a `_comment` key and Vercel's schema
// validator rejects unknown top-level properties, so deploying it verbatim
// fails with "should NOT have additional property `_comment`". We strip the
// key from THIS COPY only -- the provided file is a red line and stays
// untouched. See docs/BONUS-RULE.md for the write-up.
const config = JSON.parse(readFileSync(resolve(providedWeb, "vercel.json"), "utf8"));
const stripped = Object.keys(config).filter((k) => k.startsWith("_"));
for (const k of stripped) delete config[k];
writeFileSync(resolve(out, "vercel.json"), `${JSON.stringify(config, null, 2)}\n`);

console.log(`\nstaged in provided-ui-dist/`);
if (stripped.length) console.log(`  stripped from our copy of vercel.json: ${stripped.join(", ")}`);
console.log(`  gateway inlined: ${GATEWAY}`);
console.log(`  SPA rewrite kept, so /evals survives a hard refresh`);
console.log(`\nnext:  cd provided-ui-dist && npx vercel deploy --prod\n`);
