FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV CLEANBREAK_DATABASE_PATH=/app/artifacts/cleanbreak.db
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && apt-get update \
    && apt-get install --yes --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/lib/db/migrations ./lib/db/migrations
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/patchright-core/browsers.json ./node_modules/patchright-core/browsers.json
RUN mkdir -p /app/artifacts && chown nextjs:nodejs /app/artifacts
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint"]
CMD ["node", "server.js"]
