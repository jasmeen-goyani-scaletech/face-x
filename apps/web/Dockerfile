# Face-X web app (Next.js). Build from the repository root:  docker build -f apps/web/Dockerfile -t facex-frontend .
# NEXT_PUBLIC_* and API_ORIGIN are baked in by `next build`, so they are build arguments, not runtime settings.
# The build downloads the Google fonts, so it needs internet access.

FROM node:22-bookworm-slim AS base
RUN npm install -g pnpm@9.15.9
WORKDIR /repo
# Every workspace manifest is copied so the frozen lockfile matches; only the web app's dependencies are installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Needed by the web package's postinstall (copies the MediaPipe wasm runtime into public/).
COPY apps/web/scripts apps/web/scripts

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @facex/web
COPY apps/web apps/web
ARG API_ORIGIN=http://api:4000
ARG NEXT_PUBLIC_SITE_URL=
ARG NEXT_PUBLIC_DEMO_MODE=false
ARG NEXT_PUBLIC_API_BASE_URL=
ENV API_ORIGIN=$API_ORIGIN \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @facex/web build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @facex/web

FROM node:22-bookworm-slim AS runtime
ARG API_ORIGIN=http://api:4000
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    API_ORIGIN=$API_ORIGIN
WORKDIR /app
# Same layout as the repo so pnpm's relative symlinks in apps/web/node_modules keep resolving.
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /repo/apps/web/package.json /repo/apps/web/next.config.mjs ./apps/web/
COPY --from=build /repo/apps/web/public ./apps/web/public
COPY --from=build /repo/apps/web/.next ./apps/web/.next
WORKDIR /app/apps/web
RUN chown -R node:node .next
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0"]
