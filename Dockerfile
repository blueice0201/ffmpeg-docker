ARG FFMPEG_TARGET_PLATFORM=linux/amd64
ARG VERSION=7.1
ARG VARIANT=scratch

FROM --platform=${FFMPEG_TARGET_PLATFORM} ghcr.io/jrottenberg/ffmpeg:${VERSION}-${VARIANT} AS ffmpeg

FROM --platform=${FFMPEG_TARGET_PLATFORM} node:22.20.0-alpine AS base

WORKDIR /app

FROM base AS deps

ENV HUSKY=0

COPY package*.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY .husky/install.mjs ./.husky/install.mjs
RUN npm ci --omit=dev

FROM base AS build

ENV HUSKY=0

COPY package*.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY .husky/install.mjs ./.husky/install.mjs
RUN npm ci

COPY . .
RUN npm run build && npm run build -w @ffmpeg-rest/web

FROM base AS runtime

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

COPY --from=ffmpeg /bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /bin/ffprobe /usr/local/bin/ffprobe
COPY --from=ffmpeg /lib /lib

COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=nodejs:nodejs /app/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=nodejs:nodejs /app/apps/web/.output ./apps/web/.output
COPY --chown=nodejs:nodejs apps/web/scripts/start.mjs ./apps/web/scripts/start.mjs
COPY --chown=nodejs:nodejs package*.json ./

USER nodejs

EXPOSE 3000 3001

CMD ["npm", "run", "start:all"]
