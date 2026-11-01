# syntax=docker/dockerfile:1.7
# Multi-stage images for web, API and worker (SPEC §15.4). Build one target at a time:
#   docker build --target api|worker|web|migrate -t accordo-<target> .
# The web inlines its public configuration at build time: pass the NEXT_PUBLIC_* build args.

ARG NODE_IMAGE=node:26.13.0-slim
ARG PNPM_VERSION=12.16.1

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 CI=1
RUN npm install -g pnpm@${PNPM_VERSION} && apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# ── Full workspace build ──
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
ARG API_URL=http://localhost:4000
ARG WEB_URL=http://localhost:3000
ARG MEDIA_PUBLIC_URL=http://localhost:9000/accordo-media
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=""
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ARG NEXT_PUBLIC_ANALYTICS_SRC=""
ARG NEXT_PUBLIC_ANALYTICS_DOMAIN=""
ARG GOOGLE_CLIENT_ID=""
RUN pnpm build

# ── Migrations and base seed (one-shot job before every rollout) ──
FROM build AS migrate
ENV NODE_ENV=production
CMD ["sh", "-c", "pnpm db:deploy && pnpm db:seed"]

# ── Production dependencies of the Node services (no devDependencies) ──
FROM base AS prod-deps
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --prod --filter @accordo/api... --filter @accordo/worker...
COPY --from=build /repo/packages /tmp/packages
# Compiled workspace packages (dist/) next to their package.json.
RUN for p in /tmp/packages/*; do [ -d "$p/dist" ] && cp -r "$p/dist" "packages/$(basename "$p")/"; done; rm -rf /tmp/packages

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prod-deps --chown=node:node /repo /app
USER node

FROM runtime AS api
COPY --from=build --chown=node:node /repo/apps/api/dist /app/apps/api/dist
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /repo/apps/worker/dist /app/apps/worker/dist
WORKDIR /app/apps/worker
# The heartbeat job touches this file: stale for 3 minutes = the worker is not processing jobs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "const s=require('fs').statSync('/tmp/worker-heartbeat');process.exit(Date.now()-s.mtimeMs<180000?0:1)"
CMD ["node", "dist/main.js"]

# ── Web: Next.js standalone server ──
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/manifest.webmanifest').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
