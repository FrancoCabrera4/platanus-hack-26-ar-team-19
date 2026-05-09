# Agentic Marketplace API

Backend + AI for an agentic marketplace. Users describe products they want to post or products they want to buy. Posting creates a `Product`; buying creates a `BuyerSearch`; search jobs retrieve semantically similar products with pgvector and then buyer/seller negotiator agents try to close an agreement.

## Stack

- Express + TypeScript (`apps/api`)
- Prisma + PostgreSQL + pgvector (`packages/db`, local DB via Docker Compose)
- OpenAI or Gemini for chat/JSON generation and embeddings
- Async background jobs via in-process queue (`Job` rows persisted to DB)

## Setup

```bash
pnpm install
cp .env.example .env
cp packages/db/.env.example packages/db/.env
cp apps/api/.env.example apps/api/.env
pnpm db:up
pnpm db:setup
pnpm seed
pnpm dev
```

`pnpm db:setup` is destructive for this demo app: it enables pgvector, force-resets the schema, generates Prisma Client, and creates the vector index.

## Architecture

```text
apps/api/src/
  llm/gemini.ts              # LLM wrapper for OpenAI/Gemini text + structured JSON
  agents/
    seller-onboarding.ts     # interviews seller -> builds Product draft
    buyer-onboarding.ts      # interviews buyer -> builds BuyerSearch draft
    seller-negotiator.ts     # seller-side negotiation move
    buyer-negotiator.ts      # buyer-side negotiation move
  services/
    embeddings.ts            # embeddings + pgvector persistence helpers
    matching.ts              # vector retrieval + optional LLM re-rank
    negotiation.ts           # buyer/seller turns, accepted outcome on Negotiation
  jobs/runner.ts             # async run_search job
  routes/
    auth / users / conversations / products / searches / negotiations / jobs
```

## Data Model

- `User`: name, email, optional password hash, sessions. No role field.
- `Conversation`: one onboarding chat for `mode = "buying" | "posting_product"`, owned by one user.
- `ConversationMessage`: user/assistant/system messages. System messages store hidden draft state.
- `Product`: product being sold, with `askPrice` and natural-language `negotiationStrategy`.
- `ProductEmbedding`: pgvector embedding of product title/description/category/condition.
- `BuyerSearch`: buyer intent, budget (`maxPrice`), and buyer-side `negotiationStrategy`.
- `Negotiation`: one search/product negotiation. If `successful = true`, this row is the deal.
- `NegotiationMessage`: transcript of buyer/seller negotiation moves.
- `Job`: async search execution state.

## REST API

All bodies are JSON. Error responses are `{ "error": ... }`.

### Auth

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/auth/signup` | `{ name, email, password }` | `{ user }` |
| POST | `/auth/login` | `{ email, password }` | `{ user }` |
| POST | `/auth/logout` | | `204` |
| GET | `/auth/me` | | `{ user }` |

Auth uses the HTTP-only `am_session` cookie.

### Users

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/users` | `{ name, email }` | `User` |
| GET | `/users/:id` | | `User` |

### Conversations

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/conversations` | `{ mode: "buying" | "posting_product" }` | `{ id, mode, status, state, done, messages }` |
| GET | `/conversations?mode=buying` | | conversation summaries |
| GET | `/conversations/:id` | | conversation + visible messages + product/search |
| POST | `/conversations/:id/messages` | `{ content }` | `{ reply, state, done, productId?, searchId?, jobId? }` |
| POST | `/conversations/:id/messages/stream` | `{ content }` | SSE `{ chunk }` and final `{ done, state, productId?, searchId?, jobId? }` |

Posting mode creates a `Product`. Buying mode creates a `BuyerSearch` and immediately enqueues a search job.

### Products

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/products` | optional `?status=active&category=electronics` |
| GET | `/products/:id` | public product fields |
| GET | `/products/:id/private` | owner-only, includes `negotiationStrategy` |

### Searches & Jobs

| Method | Path | Returns |
| --- | --- | --- |
| POST | `/searches/:id/run` | `202 { jobId, searchId }` |
| GET | `/searches/:id` | search + negotiations + recent jobs |
| GET | `/jobs/:id` | `{ status, result?, error? }` |

Job result shape:

```jsonc
{
  "matches": [{ "productId": "...", "score": 0.87, "rationale": "..." }],
  "negotiations": [
    {
      "productId": "...",
      "negotiationId": "...",
      "status": "accepted",
      "successful": true,
      "finalPrice": 540000
    }
  ],
  "successfulNegotiation": {
    "negotiationId": "...",
    "productId": "...",
    "finalPrice": 540000
  }
}
```

### Negotiations

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/negotiations/:id` | transcript, product summary, outcome |

Each `NegotiationMessage` has `side`, `action`, `proposedPrice`, `content`, and `createdAt`.

## Matching & Negotiation

Matching embeds the buyer search text, retrieves nearest product embeddings with pgvector, applies coarse price/category filters, and then asks the LLM to re-rank the top candidates. If LLM re-ranking fails, vector similarity is used as the fallback score.

Negotiation runs up to 8 turns, buyer opens, and the first accept closes at the other side's last quoted price. The buyer `maxPrice` is still enforced in code. Seller behavior is guided by `askPrice` and natural-language `negotiationStrategy`, not a hidden floor.

Before accepting, a Prisma transaction re-checks that the product is still `active`, verifies the final price does not exceed the buyer budget, marks the product `sold`, and updates the `Negotiation` as successful.

## Limits

- Jobs run in-process. A restart can orphan a running job.
- This is intentionally demo-grade auth: no email verification or password reset tokens.
- Product embeddings are generated from public product descriptors, not negotiation strategy.
