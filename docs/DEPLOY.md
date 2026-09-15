# DEPLOY.md: shipping LUMINA

Target architecture:

```
Vercel (web, Next.js)  ──HTTPS──▶  Render (backend: gateway :$PORT ──▶ agent :8000, one process)
```

The backend runs the combined launcher `scripts/start-prod.mjs` (agent + gateway in one process).
The web app is a static/SSR Next.js app that calls the gateway via `NEXT_PUBLIC_GATEWAY_URL`.

---

## 0. Prerequisite: code in a Git repo

The platforms deploy from a Git repo. Make LUMINA its own repo (cleanest):

```bash
cd <...>/Assignment_1_Lumina/Lumina
git init && git add -A && git commit -m "LUMINA web slice"
# create an empty GitHub repo, then:
git remote add origin git@github.com:<you>/lumina.git
git push -u origin main
```

`.gitignore` already excludes `.env`, `node_modules`, `dist/`, `.next/`. **Never commit `.env`.**

---

## 1. Backend → Render (Web Service)

- New → Web Service → connect the repo.
- **Root Directory:** the repo root (this `Lumina/` folder).
- **Build Command:** `npm install && npm run build:backend`
- **Start Command:** `npm run start:prod`
- **Environment variables** (from your `.env`, set in the Render dashboard — never in code):
  - `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`
  - `LLM_MODEL=claude-sonnet-5`, `SEARCH_PROVIDER=tavily`
  - `MAX_TOOL_CALLS=8`, `MAX_WALL_CLOCK_SEC=90`
  - `CORS_ORIGIN=https://<your-vercel-app>.vercel.app`  (fill in after step 2; use `*` temporarily)
  - (Render injects `PORT`; the gateway reads it. The agent stays on 8000 internally.)
- Deploy. Note the public URL, e.g. `https://lumina-backend.onrender.com`.
- Verify: `curl https://lumina-backend.onrender.com/health` → 200 JSON.

## 2. Web → Vercel

- New Project → import the repo.
- **Root Directory:** `web`
- **Environment variable:** `NEXT_PUBLIC_GATEWAY_URL=https://lumina-backend.onrender.com` (step 1 URL)
- Deploy. Note the URL, e.g. `https://lumina-xyz.vercel.app`.

## 3. Close the CORS loop

- Back in Render, set `CORS_ORIGIN` to the exact Vercel URL from step 2, and redeploy the backend.
- Open the Vercel URL, ask a question — you should see the same stream you saw locally.

---

## Notes / gotchas

- **Free-tier cold starts:** Render free services sleep; the first request after idle is slow (spin-up).
- **The agent is public on Render free tier.** It has no auth of its own (the gateway is the wall). For a
  demo that's acceptable; a private service (paid) or a network rule would harden it.
- **`/evals`** page + real `report.json` numbers come after this (bench.mjs / check.mjs).
- Keys live only in Render's env. The web app ships only `NEXT_PUBLIC_GATEWAY_URL` (safe, public).
