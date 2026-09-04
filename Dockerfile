# ==============================================================
# TechMatch — production image (web + worker в одном образе, разные команды)
# ==============================================================
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------- deps: установка зависимостей по lock-файлу ----------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/integrations/package.json packages/integrations/
COPY packages/testing/package.json packages/testing/
COPY packages/ui/package.json packages/ui/
COPY packages/validation/package.json packages/validation/
RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
COPY . .
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm --filter @techmatch/database generate && pnpm --filter @techmatch/web build

# ---------- runner: web (standalone) ----------
FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd -r techmatch && useradd -r -g techmatch techmatch
COPY --from=build --chown=techmatch:techmatch /app/apps/web/.next/standalone ./
COPY --from=build --chown=techmatch:techmatch /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=techmatch:techmatch /app/apps/web/public ./apps/web/public
RUN mkdir -p /app/storage && chown techmatch:techmatch /app/storage
USER techmatch
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---------- runner: worker + миграции (полный workspace, tsx) ----------
FROM deps AS worker
ENV NODE_ENV=production
COPY . .
RUN pnpm --filter @techmatch/database generate
CMD ["pnpm", "--filter", "@techmatch/worker", "start"]
