# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @football/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @football/api build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY apps/api/package.runtime.json package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /repo/apps/api/dist ./dist
COPY apps/api/migrations ./migrations
RUN mkdir -p /data && chown -R node:node /data /app
USER node
ENV PORT=3000 HOST=0.0.0.0 DATABASE_FILE=/data/football.db MIGRATIONS_DIR=/app/migrations
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
