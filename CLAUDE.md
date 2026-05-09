# CLAUDE.md

This file provides guidance when working with this repository.

## What this project is

Hackathon project (Platanus Hack 26, Buenos Aires, team-19, "Agentic Money" track): an agentic marketplace where LLM-powered agents help users post products, search for products, and negotiate on their behalf.

`apps/api/README.md` has the canonical backend flow and REST contract. Read it first when working on backend changes.

## Common commands

All commands run from the repo root unless noted.

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm type-check

pnpm db:up
pnpm db:setup                    # destructive demo reset: pgvector + db push + generate

pnpm --filter api dev
pnpm seed                        # import latest FB Marketplace scrape
pnpm --filter api scrape:fb
pnpm --filter api seed:fb        # same importer, with optional file arg

pnpm --filter web dev
```

There is no test runner configured. `@repo/db`'s `test` script is a placeholder that exits 1; do not run it.

## Environment

- Root `.env`: `DATABASE_URL=postgresql://marketplace:marketplace@localhost:5432/marketplace?schema=public`.
- `packages/db/.env`: same `DATABASE_URL`.
- `apps/api/.env`: `DATABASE_URL`, `LLM_PROVIDER=openai|gemini`, and the matching API key. OpenAI is used automatically when `OPENAI_API_KEY` exists; otherwise Gemini is used.

## Architecture

- `apps/api`: Express + TypeScript backend.
- `apps/web`: Next.js 14 frontend.
- `packages/db`: Prisma client singleton and schema.
- `packages/logger`: thin logger wrapper.
- `packages/ui`: shared shadcn-style UI components.

## Backend Model

- `User`: unified account with no marketplace role field.
- `Conversation`: one onboarding chat with `mode = "buying" | "posting_product"`.
- `Product`: seller product with `askPrice` and natural-language `negotiationStrategy`; no hidden seller floor/ceiling fields.
- `ProductEmbedding`: pgvector embedding for semantic product retrieval.
- `BuyerSearch`: buyer intent with `maxPrice` and buyer-side `negotiationStrategy`.
- `Negotiation`: one search/product negotiation. A successful negotiation is the deal; there is no separate `Deal` model.
- `Job`: in-process async search runner state.

## Agent System

- `agents/seller-onboarding.ts`: chats with a seller and builds a Product draft.
- `agents/buyer-onboarding.ts`: chats with a buyer and builds a BuyerSearch draft.
- `agents/seller-negotiator.ts`: seller-side single-turn negotiator using ask price and negotiation strategy.
- `agents/buyer-negotiator.ts`: buyer-side single-turn negotiator using max budget and negotiation strategy.

Negotiation runs up to 8 turns. Buyer opens. An accept closes at the other side's last quoted price. The code still enforces the buyer budget and product availability inside a transaction before marking a negotiation successful and the product sold.

## Matching Pipeline

`services/matching.ts` embeds buyer search text, retrieves nearest products from `ProductEmbedding` with pgvector, applies coarse status/price/category filters, then asks the LLM to re-rank. If LLM scoring fails, vector similarity is the fallback.

## Workspace Conventions

- Internal packages are referenced as `@repo/<name>` (`workspace:*`).
- `@repo/db` exports a Prisma singleton as default: `import prisma from "@repo/db"`.
- `apps/api/data/` scraper output is gitignored.
