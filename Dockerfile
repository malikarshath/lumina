# One image, two apps. The agent and the gateway share a workspace and a
# lockfile, so they share a build; each Fly app picks its entrypoint through
# its own fly.*.toml [processes] block.
#
# The build context is the REPO ROOT, not backend/agent. That is not a
# preference: backend/agent depends on @lumina/contract, which is a sibling
# workspace, so a build rooted at the service folder cannot see the package it
# imports and fails on "Cannot find module '@lumina/contract'".

FROM node:22-slim AS build
WORKDIR /app

# Package manifests first, so a source-only change does not re-run npm ci.
COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/
COPY backend/agent/package.json backend/agent/
COPY backend/gateway/package.json backend/gateway/
COPY web/package.json web/

# `npm ci` validates the whole lockfile, so the web workspace's manifest has to
# be present even though this image never serves the UI. Its dependencies come
# along for the ride; they are dropped from the runtime stage below.
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/contract packages/contract
COPY backend backend
RUN npm run build:backend

# ---------------------------------------------------------------- runtime
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/
COPY backend/agent/package.json backend/agent/
COPY backend/gateway/package.json backend/gateway/
# The root package.json declares `web` as a workspace, so npm ci fails on a
# missing workspace manifest if this is absent -- even though the --workspace
# flags below mean none of its dependencies get installed.
COPY web/package.json web/

# Only the two services' production dependencies. `--omit=dev` alone would
# still drag in Next.js, because the UI lists it as a runtime dependency; the
# workspace flags keep the image to what these processes actually import.
RUN npm ci --omit=dev \
      --workspace backend/agent \
      --workspace backend/gateway \
      --workspace packages/contract \
      --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/packages/contract/dist packages/contract/dist
COPY --from=build /app/backend/agent/dist backend/agent/dist
COPY --from=build /app/backend/gateway/dist backend/gateway/dist

# Run unprivileged: this process holds the provider keys.
USER node

# Overridden per app by fly.agent.toml / fly.gateway.toml.
CMD ["node", "backend/gateway/dist/index.js"]
