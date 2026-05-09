# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Hackathon project (Platanus Hack 26, Buenos Aires, team-19, "Agentic Money" track): an **agentic marketplace** where Gemini-powered agents onboard sellers/buyers and then a separate pair of negotiator agents haggle on each side's behalf. The API is the substantive code; the Next.js web app is a near-empty scaffold.

`apps/api/README.md` has the canonical end-to-end flow, REST contract, and curl walkthrough — read it first when working on backend changes.

## Common commands

All commands run from the repo root unless noted. Turbo orchestrates per-package scripts.

```bash
# Top-level (turbo fans out across workspaces)
pnpm install
pnpm dev          # runs every package's dev (API tsup-watch + Next.js)
pnpm build
pnpm lint
pnpm type-check

# Database (Prisma + SQLite). The schema lives in packages/db/prisma/schema.prisma.
# Shortcut from the API package:
pnpm --filter api db:setup       # prisma db push + prisma generate
# Or directly:
pnpm --filter @repo/db db:push
pnpm --filter @repo/db db:generate

# API only
pnpm --filter api dev            # tsup --watch + auto-restart on rebuild
pnpm --filter api seed           # demo sellers/listings/search (idempotent)
pnpm --filter api scrape:fb      # Playwright scrape of FB Marketplace BA → apps/api/data/*.json
pnpm --filter api seed:fb        # import latest scrape file into the DB

# Web only
pnpm --filter web dev
```

There is no test runner configured. `@repo/db`'s `test` script is a placeholder that exits 1 — do not run it.

## Environment

Two env files matter:

- **Repo root `.env`**: only `DATABASE_URL=file:/dev.db` for Prisma codegen at the workspace root.
- **`apps/api/.env`**: needs `GEMINI_API_KEY` and an absolute-path `DATABASE_URL`. The API server warns at startup if `GEMINI_API_KEY` is unset; agent endpoints will fail without it. The absolute path matters because the API process and the Prisma CLI run from different cwds — a relative `file:./dev.db` resolves differently in each.

```bash
# In apps/api/.env, generate the absolute DB path with:
echo "DATABASE_URL=file:$(cd ../../packages/db/prisma && pwd)/dev.db" >> .env
```

## Architecture

### Monorepo layout

- `apps/api` — Express + TypeScript backend, all the agent/negotiation logic. Built with `tsup` (CJS).
- `apps/web` — Next.js 14 app. Currently a stock scaffold; treat as a placeholder.
- `packages/db` — Prisma client singleton + schema. Exports `prisma` as default. SQLite for hackathon speed; same Prisma codegen would target Postgres.
- `packages/logger` — thin `log()` wrapper.
- `packages/ui` — shadcn-style React components, Tailwind. Used by web; some types pulled in by API as a dev dep.
- `packages/config-eslint`, `config-tailwind`, `config-typescript` — shared configs (`@repo/*`).

### The agent system (apps/api/src)

There are **four** distinct agent roles, and conflating them is the easiest way to break the model:

- `agents/seller-onboarding.ts` — chats with a seller, fills a `Listing` draft (incl. the **private** `minPrice` reservation).
- `agents/buyer-onboarding.ts` — chats with a buyer, fills a `BuyerSearch` (incl. the **private** `maxPrice` reservation).
- `agents/seller-negotiator.ts` — single-turn negotiator. Sees `minPrice` (its own floor). **Never** sees the buyer's `maxPrice`.
- `agents/buyer-negotiator.ts` — single-turn negotiator. Sees `maxPrice` (its own ceiling). **Never** sees the seller's `minPrice`.

Each negotiator turn returns JSON `{ action, price, message }` with `action ∈ open|counter|accept|reject`. The orchestrator in `services/negotiation.ts` runs up to 8 turns (buyer opens, alternating). An `accept` from one side closes at the **other side's last quoted price**.

### Two invariants worth preserving

1. **Reservation prices are private.** `minPrice` and `strategyNotes` must never reach the buyer side; `maxPrice` must never reach the seller side. The public listing route `GET /listings/:id` already strips these — `GET /listings/:id/private` is the only seller-scoped read. When adding endpoints or changing prompts, keep this asymmetry.
2. **Hard safety clamps in code, not in the LLM prompt.** Prompts ask the LLM to respect floors/ceilings, but `services/negotiation.ts` re-checks every accept inside a `prisma.$transaction`: it refetches the listing, verifies `status === "active"`, asserts `finalPrice ∈ [minPrice, maxPrice]`, then atomically creates the `Deal` and flips listing to `sold`. This single transaction is what prevents double-selling under concurrent searches and what guards against LLM drift past the reservation prices. **Don't move these checks out of the transaction.**

### Matching pipeline (`services/matching.ts`)

Two-step: SQL prefilter (`status="active"`, `askPrice <= maxPrice * 1.2`, optional category) → Gemini structured-JSON scoring of top candidates. The 1.2x slack is intentional: listings priced just above the buyer's ceiling are kept in scope so the negotiator can pull them down. There is a price-distance fallback if Gemini scoring fails — keep it.

### Job runner (`jobs/runner.ts`)

In-process, persisted via the `Job` table. `enqueueRunSearch` writes a `queued` row and schedules the work via `setImmediate`. **A server restart orphans any `running` job** — fine for the demo, would need BullMQ/Redis for production.

`run_search` runs negotiations sequentially across matches and **stops at the first accepted deal** (a buyer wants one item). To switch to "collect all deals, pick cheapest," it's a single change in `executeRunSearch`.

### LLM access (`llm/gemini.ts`)

All Gemini calls go through `generate()` / `generateJSON()`. Defaults: `gemini-2.0-flash`, temperature 0.7 for prose / 0.4 for JSON. `generateJSON` requires a `jsonSchema` and uses Gemini's `responseMimeType: "application/json"` mode. If you need a new agent, add it under `agents/` and call through this wrapper rather than instantiating a new client.

### Data model highlights (`packages/db/prisma/schema.prisma`)

`User` is unified (role: `seller | buyer | both`). `Listing` and `BuyerSearch` each carry **both** their owner's reservation price and the public-facing one. `Negotiation` has a one-to-one `Deal`. `ConversationMessage` is shared between seller- and buyer-onboarding via two nullable foreign keys (one is always set).

## Workspace conventions

- Internal packages are referenced as `@repo/<name>` (`workspace:*`). `@repo/db` exports a Prisma singleton as default — import as `import prisma from "@repo/db"`.
- Add new internal packages to `pnpm-workspace.yaml` patterns (`apps/*`, `packages/*`). Turbo picks them up automatically.
- `apps/api/data/` (scraper output) is gitignored.
