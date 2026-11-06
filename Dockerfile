# syntax=docker/dockerfile:1.7
# Production image. Two runtime targets share one build:
#   web    — Next.js standalone server (default target)
#   worker — background job worker (+ used for `prisma migrate deploy`)
# Build:  docker build -t shayvera-web .   |   docker build --target worker -t shayvera-worker .
# Secrets are supplied at runtime via environment variables, never baked into the image.

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
# Build-time placeholders only; real values are injected when the container starts.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    BETTER_AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime" \
    npm run build

FROM node:${NODE_VERSION} AS web
WORKDIR /app
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 JOB_RUNNER=worker
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
RUN mkdir -p /app/storage/uploads && chown -R app:app /app/storage
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]

FROM deps AS worker
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production JOB_RUNNER=worker
COPY --chown=app:app . .
RUN npx prisma generate && mkdir -p /app/storage/uploads && chown -R app:app /app/storage
USER app
CMD ["npm", "run", "worker"]
