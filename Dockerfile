# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# base - shared by every stage
#
# Debian rather than alpine, which is what the frontend uses: this service
# renders PDFs and drives the assistant's browser through puppeteer, and
# Chromium on musl is a fight over fonts and missing glibc symbols that Debian
# simply does not have. bcrypt's prebuilt binaries are glibc-only too.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# puppeteer downloads its own ~150MB Chromium on install. We install Debian's
# instead - patched by the distro and shared with nothing else to download -
# and point puppeteer at it. PUPPETEER_EXECUTABLE_PATH is read by
# puppeteer.launch() directly, so no launch option has to change.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# ---------------------------------------------------------------------------
# deps - the full dependency tree, including devDependencies, for the build
# ---------------------------------------------------------------------------
FROM base AS deps
# bcrypt falls back to compiling from source whenever its prebuilt binary is
# not available for the platform, and node-gyp needs a toolchain to do it.
# None of this reaches the runner stage.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev

# ---------------------------------------------------------------------------
# prod-deps - the same install with devDependencies pruned, for the runner
# ---------------------------------------------------------------------------
FROM base AS prod-deps
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ---------------------------------------------------------------------------
# builder - `prisma generate` then `tsc`
# ---------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# prisma.config.ts resolves the datasource through env('DATABASE_URL'), so the
# variable has to exist for the CLI to load its config at all. `prisma
# generate` never opens a connection, so the value is irrelevant - the real
# URL is supplied to the running container.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build

RUN npm run build

# ---------------------------------------------------------------------------
# runner - the image that actually ships
# ---------------------------------------------------------------------------
FROM base AS runner

# chromium for puppeteer, plus the font packages it needs to render anything
# beyond tofu boxes - fonts-liberation covers the Arial/Times metrics that
# statement templates assume, and the Noto packages cover everything else.
# dumb-init reaps the zombie processes Chromium leaves behind and forwards
# SIGTERM to node so the graceful shutdown in server.ts actually runs.
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium \
        dumb-init \
        fonts-liberation \
        fonts-noto-core \
        fonts-noto-color-emoji \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PORT=8000

COPY --from=prod-deps /app/node_modules ./node_modules
# The generated client, and the CLI and engines that `prisma migrate deploy`
# needs. They live in devDependencies, so the pruned tree above does not have
# them, but migrations have to be runnable from the deployed image.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

COPY --from=builder /app/dist ./dist
COPY package.json prisma.config.ts ./
COPY prisma ./prisma

# node:22 images already ship an unprivileged `node` user. winston creates
# ./logs itself on boot, but only if it can write to the working directory.
RUN mkdir -p logs && chown -R node:node /app/logs

USER node
EXPOSE 8000

# /health answers without touching Postgres or Redis: a restart is the only
# thing an orchestrator can do about a failed probe, and restarting this
# container would not fix a database that is down.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
