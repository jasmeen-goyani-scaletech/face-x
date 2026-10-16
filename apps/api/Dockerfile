# Face-X API image. Build from the REPOSITORY ROOT (the pnpm workspace and lockfile live there):
#   docker build -f apps/api/Dockerfile -t facex-api .
# Run:  docker run -p 4000:4000 --env-file <your env file> facex-api
# Migrations are a separate step (see docs/deployment.md): docker run --env-file <migrator env> facex-api node dist/infrastructure/database/cli.js migrate
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

# Workspace manifests first, so the dependency layer is cached until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# Dev dependencies are needed for the TypeScript build only; they are removed again below. (NODE_ENV is set after installing,
# or pnpm would skip them.)
RUN pnpm install --frozen-lockfile --filter @facex/api...

COPY apps/api apps/api
RUN pnpm --filter @facex/api build \
 && pnpm install --frozen-lockfile --filter @facex/api... --prod

WORKDIR /repo/apps/api
ENV NODE_ENV=production
USER node
EXPOSE 4000
# PORT, DATABASE_URL and every other setting come from the environment (apps/api/.env.example lists them).
CMD ["node", "dist/server.js"]
