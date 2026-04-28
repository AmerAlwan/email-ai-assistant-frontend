# syntax=docker/dockerfile:1

# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Enable corepack so pnpm is available without a separate install step
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile

# ── Stage 2: dev ──────────────────────────────────────────────────────────────
# Used by Docker Compose in development — source is bind-mounted over /app/src.
FROM node:22-alpine AS dev
WORKDIR /app

RUN corepack enable

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
# Copy everything else (bind-mount will override in docker compose watch)
COPY . .

EXPOSE 3000

# next dev --turbopack with polling for Docker Desktop on Windows/macOS
ENV NEXT_TELEMETRY_DISABLED=1
ENV WATCHPACK_POLLING=true
CMD ["pnpm", "dev"]
