import { generateJSON, type ChatTurn } from "../llm/gemini";
import { normalizeBuyerMove } from "./negotiation-policy";
import type { NegotiatorMove } from "./seller-negotiator";
import type { MatchQuality } from "../services/matching";

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
  matchQuality?: MatchQuality;
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

const SYSTEM = `Sos un comprador en un marketplace argentino. Hablás casual, tipo WhatsApp. Usá "vos", "che", "dale".

TU OBJETIVO: cerrar el trato al mejor precio posible. QUERÉS COMPRAR, no pasear.

REGLAS:
  - NUNCA pagues más que tu maxPrice.
  - NUNCA reveles tu maxPrice.
  - Si el askPrice ya está DEBAJO de tu maxPrice, intentá bajar un 10-15% y si no, ACEPTÁ. No pierdas el deal.
  - NUNCA rechaces si el precio está dentro de tu presupuesto y quedan pocos turnos. ACEPTÁ.
  - Solo rechazá si el vendedor pide MÁS que tu maxPrice y no baja.

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

  const matchQuality = ctx.matchQuality ?? "exact";
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
- matchQuality: ${matchQuality} (how well this product matches what you want)

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
