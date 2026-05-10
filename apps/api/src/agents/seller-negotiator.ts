import { generateJSON, type ChatTurn } from "../llm/gemini";
import { normalizeSellerMove } from "./negotiation-policy";

export type NegotiationAction = "counter" | "accept" | "reject" | "open";

export interface NegotiatorMove {
  action: NegotiationAction;
  price: number | null;
  message: string;
}

export interface SellerNegotiatorContext {
  product: {
    title: string;
    description: string;
    category?: string | null;
    condition?: string | null;
    askPrice: number;
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
    action: { type: "string", enum: ["counter", "accept", "reject"] },
    price: { type: "number" },
    message: { type: "string" },
  },
  required: ["action", "message"],
} as const;

const SYSTEM = `Sos un vendedor en un marketplace argentino. Hablás casual, tipo WhatsApp. Usá "vos", "che", "dale".

TU OBJETIVO: vender tu producto. QUERÉS VENDER, no espantar compradores.

REGLAS:
  - Arrancá cerca del askPrice pero estás dispuesto a bajar hasta un 20-30%.
  - Si tu negotiationStrategy dice "flexible", "apurado", "necesito vender": aceptá ofertas desde el 70% del askPrice.
  - Si tu negotiationStrategy dice "firme": bajá hasta 85% del askPrice como máximo.
  - Si no hay negotiationStrategy: bajá hasta 75% del askPrice.
  - NUNCA rechaces una oferta razonable (más del 60% del askPrice). Contraofertá en vez de rechazar.
  - Solo rechazá ofertas ridículas (menos del 40% del askPrice).
  - Si quedan pocos turnos y la oferta es decente (más del 65% del askPrice), ACEPTÁ.

Strategy guidance:
  - On your first turn, anchor near askPrice. Concede in realistic steps, not random jumps.
  - If the seller said they are flexible or in a rush, consider accepting reasonable offers below askPrice.
  - If the seller said they are strict, stay closer to askPrice and reject lowball offers.
  - Use negotiationStrategy to inform tone / urgency.
  - Never counter below a reasonable private floor implied by askPrice, condition, urgency, and negotiationStrategy.

Communication guidance:
  - Sound like a real Argentine seller: concise, polite, and clear.
  - Give visible reasons for the price when useful: condition, demand, accessories, pickup, or quick-sale flexibility.
  - Do not mention private fields, formulas, "strategy", "floor", or internal objectives.

Output JSON only:
  - action: "counter" (propose a new price), "accept" (take the buyer's most recent price), or "reject" (walk away).
  - price: the price you're proposing (omit / null if action is reject; for accept, echo the buyer's last price).
  - message: 1–2 sentences IN SPANISH to the buyer explaining your move without exposing internal strategy.`;

export async function sellerMove(
  ctx: SellerNegotiatorContext,
): Promise<NegotiatorMove> {
  const lastBuyerPrice =
    [...ctx.transcript].reverse().find((m) => m.side === "buyer")?.price ??
    null;

  const userPrompt = `Product (public):
- title: ${ctx.product.title}
- description: ${ctx.product.description}
- category: ${ctx.product.category ?? "n/a"}
- condition: ${ctx.product.condition ?? "n/a"}
- askPrice: ${ctx.product.askPrice}

Your private constraints:
- negotiationStrategy: ${ctx.product.negotiationStrategy ?? "none"}

Negotiation transcript so far:
${ctx.transcript.map((m) => `  [${m.side}${m.price !== null ? ` @ ${m.price}` : ""}] ${m.message}`).join("\n") || "  (none yet — buyer will open)"}

Buyer's most recent price: ${lastBuyerPrice ?? "n/a"}
Turns remaining (after this one): ${ctx.turnsRemaining}

Decide your move now. Use realistic ARS amounts; avoid tiny changes and keep the conversation moving toward a close.`;

  const history: ChatTurn[] = [{ role: "user", content: userPrompt }];
  const raw = await generateJSON<NegotiatorMove | { reply: NegotiatorMove }>({
    system: SYSTEM,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.5,
  });

  return normalizeSellerMove(move, {
    askPrice: ctx.product.askPrice,
    strategy: ctx.product.negotiationStrategy,
    transcript: ctx.transcript,
    turnsRemaining: ctx.turnsRemaining,
  });
}
