# Agentic Marketplace API

Backend + AI for an agentic marketplace. Sellers describe their item to an LLM-powered seller agent; buyers describe what they want to an LLM-powered buyer agent. When a buyer kicks off a search, two more agents (a seller-side negotiator and a buyer-side negotiator) haggle on each side's behalf — neither sees the other's reservation price — and a deal is booked when they meet in the middle.

## Stack

- Express + TypeScript (`apps/api`)
- Prisma + PostgreSQL (`packages/db`, local DB via Docker Compose)
- OpenAI via `openai` or Gemini via `@google/generative-ai`
- Async background jobs via in-process queue (Job rows persisted to DB)

## Setup

1. **Install** (from repo root):
   ```bash
   pnpm install
   ```
2. **Start PostgreSQL and sync the Prisma schema** (one-time, from repo root):
   ```bash
   cp .env.example .env
   cp packages/db/.env.example packages/db/.env
   pnpm db:up
   pnpm db:setup
   ```
3. **Configure `apps/api/.env`** (copy from `.env.example`):
   ```bash
   cd apps/api
   cp .env.example .env
   # edit .env:
   #   LLM_PROVIDER=openai or gemini
   #   OPENAI_API_KEY=...your key from https://platform.openai.com/api-keys
   #   GEMINI_API_KEY=...your key from https://aistudio.google.com/app/apikey
   #   DATABASE_URL=postgresql://marketplace:marketplace@localhost:5432/marketplace?schema=public
   ```
4. **Seed demo data** (optional, lets you skip the onboarding chats):
   ```bash
   pnpm seed
   ```
5. **Run**:
   ```bash
   pnpm dev   # tsup watch + auto-restart
   # or
   pnpm build && pnpm start
   ```

## Architecture

```
apps/api/src/
  llm/gemini.ts           # LLM wrapper for OpenAI/Gemini (text + structured JSON output)
  agents/
    seller-onboarding.ts  # interviews seller → builds Listing draft
    buyer-onboarding.ts   # interviews buyer → builds BuyerSearch draft
    seller-negotiator.ts  # one move in a negotiation, sees minPrice (private)
    buyer-negotiator.ts   # one move in a negotiation, sees maxPrice (private)
  services/
    matching.ts           # SQL prefilter + LLM relevance scoring
    negotiation.ts        # orchestrates buyer↔seller turns, books deal
  jobs/
    runner.ts             # async run_search job: match → negotiate → deal
  routes/
    users / sellers / buyers / listings / searches / negotiations / jobs
```

### Negotiation contract

Each agent returns JSON: `{ action, price, message }`.

- `action` ∈ `open` | `counter` | `accept` | `reject`
- The seller agent NEVER sees the buyer's `maxPrice`; the buyer agent NEVER sees the seller's `minPrice`. Each just gets its own constraints.
- After the LLM responds we apply a **hard safety floor/ceiling** in code: if the LLM ever drifts past `minPrice` (seller) or `maxPrice` (buyer), we clamp or convert `accept` to `counter`. This is the safety net under the prompt rules.
- Max 8 turns. Buyer opens. First `accept` from either side at the other's last quoted price closes the deal.
- Before booking, a `prisma.$transaction` re-checks the listing is still `active` and the price is within both reservations, then atomically creates the `Deal` and flips the listing to `sold`. This prevents one item being sold twice if multiple buyers run searches concurrently.

## REST API

All bodies are JSON. Error responses are `{ "error": ... }`.

### Users

| Method | Path             | Body                          | Returns          |
| ------ | ---------------- | ----------------------------- | ---------------- |
| POST   | `/users`         | `{ name, email, role }`       | `User`           |
| GET    | `/users/:id`     |                               | `User`           |

`role`: `"seller" | "buyer" | "both"`. Re-posting the same email returns the existing user (idempotent).

### Seller onboarding

| Method | Path                                   | Body                  | Returns                                   |
| ------ | -------------------------------------- | --------------------- | ----------------------------------------- |
| POST   | `/sellers/conversations`               | `{ sellerId }`        | `{ id, state, done, messages }`           |
| POST   | `/sellers/conversations/:id/messages`  | `{ content }`         | `{ reply, state, done, listingId? }`      |
| GET    | `/sellers/conversations/:id`           |                       | conversation + messages + listing         |

When `done: true`, a `Listing` is created and `listingId` is returned.

### Buyer onboarding

| Method | Path                                  | Body                  | Returns                              |
| ------ | ------------------------------------- | --------------------- | ------------------------------------ |
| POST   | `/buyers/conversations`               | `{ buyerId }`         | `{ id, state, done, messages }`      |
| POST   | `/buyers/conversations/:id/messages`  | `{ content }`         | `{ reply, state, done, searchId? }` |
| GET    | `/buyers/conversations/:id`           |                       | conversation + messages + search    |

When `done: true`, a `BuyerSearch` is created with status `ready`.

### Listings (public)

| Method | Path                       | Notes                                              |
| ------ | -------------------------- | -------------------------------------------------- |
| GET    | `/listings`                | optional `?status=active&category=electronics`     |
| GET    | `/listings/:id`            | excludes `minPrice` and `strategyNotes` (private)  |
| GET    | `/listings/:id/private`    | requires `?sellerId=...` (must match owner)        |

### Searches & jobs

| Method | Path                          | Body | Returns                               |
| ------ | ----------------------------- | ---- | ------------------------------------- |
| POST   | `/searches/:id/run`           |      | `202 { jobId, searchId }` (async)     |
| GET    | `/searches/:id`               |      | search + negotiations + deals + jobs  |
| GET    | `/jobs/:id`                   |      | `{ status, result?, error? }`         |

`POST /searches/:id/run` returns immediately. Poll `GET /jobs/:id` until `status` is `succeeded` or `failed`. The `result` field contains:

```jsonc
{
  "matches": [{ "listingId": "...", "score": 0.87, "rationale": "..." }],
  "negotiations": [
    { "listingId": "...", "negotiationId": "...", "status": "accepted", "finalPrice": 540000, "dealId": "..." }
  ],
  "bestDeal": { "dealId": "...", "listingId": "...", "finalPrice": 540000 }
}
```

### Negotiations

| Method | Path                  | Returns                                    |
| ------ | --------------------- | ------------------------------------------ |
| GET    | `/negotiations/:id`   | full transcript, listing summary, deal     |

Each `NegotiationMessage` has `side`, `action`, `proposedPrice`, `content`, `createdAt` — useful for replaying the conversation in a UI.

## End-to-end demo (curl)

The fastest way to see the whole loop, using the seed data:

```bash
# 1. Run the seed (one time)
pnpm seed
# → prints buyer and search IDs. Save the search ID.

# 2. Kick off the search
SEARCH_ID=<paste from seed output>
JOB=$(curl -sX POST http://localhost:4000/searches/$SEARCH_ID/run | jq -r .jobId)

# 3. Poll until done (negotiations take ~10–30s of LLM calls)
while true; do
  STATUS=$(curl -s http://localhost:4000/jobs/$JOB | jq -r .status)
  echo "job: $STATUS"
  [ "$STATUS" = "succeeded" -o "$STATUS" = "failed" ] && break
  sleep 2
done

# 4. See the result + best deal
curl -s http://localhost:4000/jobs/$JOB | jq

# 5. Read a negotiation transcript
NEG_ID=$(curl -s http://localhost:4000/searches/$SEARCH_ID | jq -r '.negotiations[0].id')
curl -s http://localhost:4000/negotiations/$NEG_ID | jq
```

To exercise the **onboarding agents** end-to-end (real chat, not seeded):

```bash
# Create users
SELLER=$(curl -sX POST http://localhost:4000/users -H 'content-type: application/json' \
  -d '{"name":"Ana","email":"ana@x.com","role":"seller"}' | jq -r .id)
BUYER=$(curl -sX POST http://localhost:4000/users -H 'content-type: application/json' \
  -d '{"name":"Diego","email":"diego@x.com","role":"buyer"}' | jq -r .id)

# Start seller onboarding
SCONV=$(curl -sX POST http://localhost:4000/sellers/conversations -H 'content-type: application/json' \
  -d "{\"sellerId\":\"$SELLER\"}" | jq -r .id)

# Reply turns
curl -sX POST http://localhost:4000/sellers/conversations/$SCONV/messages \
  -H 'content-type: application/json' \
  -d '{"content":"Selling an iPhone 13 128GB, like new, with original box"}'
# … keep responding until { "done": true, "listingId": "..." }

# Same for the buyer
BCONV=$(curl -sX POST http://localhost:4000/buyers/conversations -H 'content-type: application/json' \
  -d "{\"buyerId\":\"$BUYER\"}" | jq -r .id)
curl -sX POST http://localhost:4000/buyers/conversations/$BCONV/messages \
  -H 'content-type: application/json' \
  -d '{"content":"I want an iPhone 13, max 580000 ARS"}'
# … until you get { "done": true, "searchId": "..." }

# Then run the search as in the seed flow above.
```

## Notes & limits

- The job runner is in-process. Restart the server and any `running` job is orphaned — fine for hackathon, replace with BullMQ/Redis for production.
- The 20% slack on price filtering (`askPrice <= maxPrice * 1.2`) keeps listings priced just above the buyer's ceiling in scope so the negotiator can pull them down.
- Negotiation runs sequentially across candidate listings and stops at the first deal. Switching to "accumulate all deals and pick cheapest" is a one-line change in `jobs/runner.ts`.
- Listings are flipped to `sold` inside the same transaction as deal creation, so two concurrent searches can't double-book the same listing.
