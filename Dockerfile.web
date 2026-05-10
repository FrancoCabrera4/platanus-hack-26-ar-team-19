FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/logger/package.json packages/logger/
COPY packages/config-eslint/package.json packages/config-eslint/
COPY packages/config-typescript/package.json packages/config-typescript/
COPY packages/ui/package.json packages/ui/
COPY packages/tailwind-config/package.json packages/tailwind-config/
RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/web/ apps/web/

RUN pnpm --filter @repo/db exec prisma generate
RUN pnpm --filter web build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]
