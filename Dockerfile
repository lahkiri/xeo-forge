# syntax=docker/dockerfile:1
#
# Xeo Forge — production image.
#
# Stages:
#   deps    — install npm dependencies
#   builder — build the Next.js standalone output (also used as the `init`
#             one-shot image that runs scripts/db-init.ts against Postgres)
#   runner  — minimal runtime: standalone server + bash/python3 for the
#             agent's code_execute tool

# ---------- deps ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build with NODE_ENV=production so Next produces the standalone output.
RUN npm run build

# ---------- runner ----------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# bash + python3 are required by the agent's code_execute tool.
# curl is used by the agent's http_request tool for CLI-ish workflows.
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash python3 curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
