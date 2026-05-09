import { generateJSON, type ChatTurn } from "../llm/gemini";
import { normalizeBuyerMove } from "./negotiation-policy";
import type { NegotiatorMove } from "./seller-negotiator";

export interface BuyerNegotiatorContext {
  product: {
    title: string;
    description: string;
    category?: string | null;
    condition?: string | null;
    askPrice: number;
  };
  search: {
    query: string;
    requirements?: string | null;
    maxPrice: number;
    negotiationStrategy?: string | null;
  };
  transcript: {
    side: "seller" | "buyer";
    price: number | null;
    message: string;
  }[];
  turnsRemaining: number;
}

const SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["open", "counter", "accept", "reject"] },
    price: { type: "number" },
    message: { type: "string" },
  },
  required: ["action", "message"],
} as const;

const SYSTEM = `You are the BUYER agent in a marketplace negotiation. Your job is to minimize the final price
without losing a good deal.

IMPORTANT: Always write your messages in Spanish (Argentina). Use "vos" instead of "tú".

Hard rules (you must respect these):
  - NEVER agree to a price above your maxPrice. Reject the deal first.
  - NEVER reveal your maxPrice to the seller in your message text. It is private.
  - Stay in character as a buyer: interested but cost-conscious, polite.

Strategy guidance:
  - On your opening turn (action="open"), anchor below askPrice but avoid insulting lowballs.
  - On counters, improve gradually, never bid against yourself, and keep the number below the seller's latest price.
  - If the seller's offer is at or below your maxPrice and turnsRemaining is low, consider accepting.
  - Accept early only when the seller's price is clearly strong for your objective.
  - If the seller won't go below your maxPrice and turns are running out, reject.

Communication guidance:
  - Sound like a real Argentine buyer: concise, warm, and specific about the visible reason for your move.
  - Mention practical public factors when useful: condition, pickup timing, included accessories, or market alternatives.
  - Do not mention private fields, formulas, "strategy", "ceiling", or internal objectives.

Output JSON only:
  - action: "open" (your very first turn), "counter", "accept" (take the seller's most recent price), or "reject".
  - price: the price you're proposing (omit / null if action is reject; for accept, echo the seller's last price).
  - message: 1–2 sentences IN SPANISH to the seller explaining your move (no internal numbers like maxPrice).`;

export async function buyerMove(
  ctx: BuyerNegotiatorContext,
): Promise<NegotiatorMove> {
  const lastSellerPrice =
    [...ctx.transcript].reverse().find((m) => m.side === "seller")?.price ??
    null;
  const isOpening = ctx.transcript.length === 0;

  const userPrompt = `Product (public):
- title: ${ctx.product.title}
- description: ${ctx.product.description}
- category: ${ctx.product.category ?? "n/a"}
- condition: ${ctx.product.condition ?? "n/a"}
- askPrice: ${ctx.product.askPrice}

Your private constraints:
- maxPrice (ceiling, never reveal): ${ctx.search.maxPrice}
- negotiationStrategy: ${ctx.search.negotiationStrategy ?? "none"}
- what you want: ${ctx.search.query}
- requirements: ${ctx.search.requirements ?? "none"}

Negotiation transcript so far:
${ctx.transcript.map((m) => `  [${m.side}${m.price !== null ? ` @ ${m.price}` : ""}] ${m.message}`).join("\n") || "  (none yet — you are opening)"}

Seller's most recent price: ${lastSellerPrice ?? "n/a"}
Turns remaining (after this one): ${ctx.turnsRemaining}
Is this your opening turn? ${isOpening ? "yes — use action=open" : "no"}

Decide your move now. Use realistic ARS amounts; avoid tiny changes and avoid jumps that reveal your budget.`;

  const history: ChatTurn[] = [{ role: "user", content: userPrompt }];
  const move = await generateJSON<NegotiatorMove>({
    system: SYSTEM,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.5,
  });

  return normalizeBuyerMove(move, {
    askPrice: ctx.product.askPrice,
    maxPrice: ctx.search.maxPrice,
    strategy: ctx.search.negotiationStrategy,
    transcript: ctx.transcript,
    turnsRemaining: ctx.turnsRemaining,
  });
}
