import { generateJSON, type ChatTurn } from "../llm/gemini";

export type NegotiationAction = "counter" | "accept" | "reject" | "open";

export interface NegotiatorMove {
  action: NegotiationAction;
  price: number | null;
  message: string;
}

export interface SellerNegotiatorContext {
  listing: {
    title: string;
    description: string;
    category?: string | null;
    condition?: string | null;
    askPrice: number;
    minPrice: number;
    strategyNotes?: string | null;
  };
  transcript: { side: "seller" | "buyer"; price: number | null; message: string }[];
  turnsRemaining: number;
}

const SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["counter", "accept", "reject"] },
    price: { type: "number" },
    message: { type: "string" },
  },
  required: ["action", "message"],
} as const;

const SYSTEM = `You are the SELLER agent in a marketplace negotiation. Your job is to maximize the final sale price
without losing the deal.

Hard rules (you must respect these):
  - NEVER accept a price below your minPrice. Reject the deal first.
  - NEVER reveal your minPrice to the buyer in your message text. It is private.
  - Stay in character as a seller: confident, polite, willing to negotiate.

Strategy guidance:
  - On your first turn, anchor near askPrice. Concede slowly.
  - If the buyer is below minPrice, counter at a price between minPrice and your previous offer.
  - If the buyer's offer is between minPrice and askPrice and turnsRemaining is low, consider accepting.
  - Use strategyNotes to inform tone / urgency.

Output JSON only:
  - action: "counter" (propose a new price), "accept" (take the buyer's most recent price), or "reject" (walk away).
  - price: the price you're proposing (omit / null if action is reject; for accept, echo the buyer's last price).
  - message: 1–2 sentences to the buyer explaining your move (no internal numbers like minPrice).`;

export async function sellerMove(ctx: SellerNegotiatorContext): Promise<NegotiatorMove> {
  const lastBuyerPrice =
    [...ctx.transcript].reverse().find((m) => m.side === "buyer")?.price ?? null;

  const userPrompt = `Listing (public):
- title: ${ctx.listing.title}
- description: ${ctx.listing.description}
- category: ${ctx.listing.category ?? "n/a"}
- condition: ${ctx.listing.condition ?? "n/a"}
- askPrice: ${ctx.listing.askPrice}

Your private constraints:
- minPrice (floor, never reveal): ${ctx.listing.minPrice}
- strategyNotes: ${ctx.listing.strategyNotes ?? "none"}

Negotiation transcript so far:
${ctx.transcript.map((m) => `  [${m.side}${m.price !== null ? ` @ ${m.price}` : ""}] ${m.message}`).join("\n") || "  (none yet — buyer will open)"}

Buyer's most recent price: ${lastBuyerPrice ?? "n/a"}
Turns remaining (after this one): ${ctx.turnsRemaining}

Decide your move now.`;

  const history: ChatTurn[] = [{ role: "user", content: userPrompt }];
  const move = await generateJSON<NegotiatorMove>({
    system: SYSTEM,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.5,
  });

  // Safety: enforce hard floor regardless of what the model said.
  if (move.action === "accept" && lastBuyerPrice !== null && lastBuyerPrice < ctx.listing.minPrice) {
    return {
      action: "counter",
      price: ctx.listing.minPrice,
      message: "I appreciate the offer, but I can't go that low. How about this instead?",
    };
  }
  if (move.action === "counter" && typeof move.price === "number" && move.price < ctx.listing.minPrice) {
    move.price = ctx.listing.minPrice;
  }
  return move;
}
