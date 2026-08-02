# syntax=docker/dockerfile:1

# ---- base -------------------------------------------------------------------
FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && apk add --no-cache openssl
COPY package.json pnpm-lock.yaml* ./

# ---- development ------------------------------------------------------------
FROM base AS development
ENV NODE_ENV=development
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm db:generate
EXPOSE 3000
CMD ["pnpm", "dev"]

# ---- build ------------------------------------------------------------------
FROM base AS build
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm db:generate && pnpm build && pnpm prune --prod

# ---- production -------------------------------------------------------------
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl && addgroup -S pulse && adduser -S pulse -G pulse

COPY --from=build --chown=pulse:pulse /app/node_modules ./node_modules
COPY --from=build --chown=pulse:pulse /app/dist ./dist
COPY --from=build --chown=pulse:pulse /app/prisma ./prisma
COPY --from=build --chown=pulse:pulse /app/package.json ./package.json

USER pulse
EXPOSE 3000

# The orchestrator uses /health/ready; this is a cheap in-container backstop.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
