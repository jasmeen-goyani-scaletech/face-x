# Face-X API (Express). Build from the repository root:  docker build -f apps/api/Dockerfile -t facex-backend .
# The same image runs the API (default command) and the migrations (`node dist/infrastructure/database/cli.js migrate`).

FROM node:22-bookworm-slim AS base
RUN npm install -g pnpm@9.15.9
WORKDIR /repo
# Every workspace manifest is copied so the frozen lockfile matches; only the API's dependencies are installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @facex/api
COPY apps/api apps/api
RUN pnpm --filter @facex/api build

# Runtime dependencies. NODE_ENV=development also needs the devDependencies (the logger then uses pino-pretty).
FROM base AS prod-deps
ARG NODE_ENV=production
RUN if [ "$NODE_ENV" = "production" ]; then \
      pnpm install --frozen-lockfile --prod --filter @facex/api; \
    else \
      pnpm install --frozen-lockfile --filter @facex/api; \
    fi

FROM node:22-bookworm-slim AS runtime
ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV \
    PORT=4000
WORKDIR /app
# Same layout as the repo so pnpm's relative symlinks in apps/api/node_modules keep resolving.
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/
COPY apps/api/db ./apps/api/db
WORKDIR /app/apps/api
# Folder for STORAGE_DRIVER=local (development only); a volume is mounted here by docker-compose.yml.
RUN mkdir -p .local-storage && chown node:node .local-storage
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
