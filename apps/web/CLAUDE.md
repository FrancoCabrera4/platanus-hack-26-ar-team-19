# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Platanus Hack 26 project (Track: Agentic Money). This is a pnpm + Turborepo monorepo. The working directory is `apps/web` but the monorepo root is two levels up at `../../`.

## Commands

All commands run from the **monorepo root** (`../../`) unless noted otherwise.

```bash
# Install dependencies
pnpm install

# Dev (all apps in parallel: web on :3000, api on :4000)
pnpm dev

# Build all
pnpm build

# Lint all
pnpm lint

# Type-check all
pnpm type-check

# Format
pnpm format
```

From `apps/web`:
```bash
pnpm dev          # Next.js dev server on :3000
pnpm build        # Next.js production build
pnpm lint         # ESLint
pnpm type-check   # tsc --noEmit
```

From `apps/api`:
```bash
pnpm dev    # Express dev server on :4000 (tsup --watch)
pnpm build  # tsup build
```

### Database (packages/db)

Prisma with PostgreSQL. Requires `DATABASE_URL` env var (see `packages/db/.env.example`).

```bash
pnpm db:generate   # Generate Prisma client
pnpm db:push       # Push schema to DB (no migration)
pnpm db:dev        # Run migrations + generate client
pnpm db:seed       # Seed database
```

Turbo runs `db:generate` automatically before `build` and `dev`.

## Architecture

### Monorepo structure

- **`apps/web`** — Next.js 14 frontend (App Router, Tailwind CSS). Imports `@repo/ui` and `@repo/db`.
- **`apps/api`** — Express API server (tsup-bundled). Uses `@repo/logger`. Runs on port 4000.
- **`packages/db`** — Prisma client singleton. Schema at `prisma/schema.prisma`. Exported as `@repo/db`.
- **`packages/ui`** — Shared component library using shadcn/ui (Radix + Tailwind + CVA). Add components via `pnpm ui:add` from this package. Exported as `@repo/ui`.
- **`packages/logger`** — Simple logging utility (`@repo/logger`).
- **`packages/config-tailwind`** — Shared Tailwind config. Both `apps/web` and `packages/ui` use it as a preset.
- **`packages/config-eslint`** — Shared ESLint config.
- **`packages/config-typescript`** — Shared TS configs (`base.json`, `nextjs.json`, `react-library.json`).

### Key conventions

- **Package manager**: pnpm (v10.30.3). Workspaces defined in `pnpm-workspace.yaml`.
- **UI components**: shadcn/ui in `packages/ui`. To add a component: `cd packages/ui && pnpm ui:add <component>`. Import in web as `@repo/ui/components/<name>`.
- **Tailwind**: Shared config via `@repo/tailwind-config` preset. Web app content path is `./src/app/**/*.tsx`.
- **Next.js**: Uses `transpilePackages: ["@repo/ui"]` to compile the UI package.
- **Prisma**: Singleton pattern in `packages/db/src/index.ts` prevents multiple client instances in dev.
