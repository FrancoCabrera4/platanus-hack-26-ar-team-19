import { generateJSON, type ChatTurn } from "../llm/gemini";
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
  transcript: { side: "seller" | "buyer"; price: number | null; message: string }[];
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

ESTRATEGIA RÁPIDA (hay pocos turnos, sé eficiente):
  - Apertura: ofrecé 15-25% menos que el askPrice. Sé directo: "Che, te ofrezco X, ¿va?"
  - Si el vendedor contrapropone dentro de tu maxPrice: aceptá o subí un poco y cerrá.
  - Último turno: si está en tu presupuesto, ACEPTÁ. No pierdas la oportunidad.
  - Mencioná algo del producto para mostrar que lo miraste.

MATCH QUALITY:
  - "exact": Querés esto. Negociá pero no seas tacaño. Cerrá rápido.
  - "close": Te interesa. Pedí un poco menos porque no es exactamente lo tuyo.
  - "approximate": Puede servir. Solo comprá si el precio es muy bueno.

Output JSON:
  - action: "open" | "counter" | "accept" | "reject"
  - price: tu precio (null para reject; para accept, repetí el último precio del vendedor)
  - message: 1 oración corta y natural EN ESPAÑOL.`;

export async function buyerMove(ctx: BuyerNegotiatorContext): Promise<NegotiatorMove> {
  const lastSellerPrice =
    [...ctx.transcript].reverse().find((m) => m.side === "seller")?.price ?? null;
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

Decide your move now.`;

  const history: ChatTurn[] = [{ role: "user", content: userPrompt }];
  const raw = await generateJSON<NegotiatorMove | { reply: NegotiatorMove }>({
    system: SYSTEM,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.5,
  });

  const move: NegotiatorMove = "reply" in raw && raw.reply?.action ? raw.reply : raw as NegotiatorMove;

  // Safety: enforce hard ceiling.
  if (move.action === "accept" && lastSellerPrice !== null && lastSellerPrice > ctx.search.maxPrice) {
    return {
      action: "counter",
      price: ctx.search.maxPrice,
      message: "Se me va un poco del presupuesto. ¿Podrías acercarte a este precio?",
    };
  }
  if (move.action === "counter" && typeof move.price === "number" && move.price > ctx.search.maxPrice) {
    move.price = ctx.search.maxPrice;
  }
  if (isOpening && move.action !== "open") {
    move.action = "open";
  }
  return move;
}
