import { generateJSON, type ChatTurn } from "../llm/gemini";

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

ESTRATEGIA RÁPIDA:
  - Primera respuesta: ofrecé el askPrice o un 5% menos. Mencioná algo del producto.
  - Si el comprador ofrece algo razonable, bajá un poco y cerrá. No seas terco.
  - Último turno: si la oferta es más del 65% del askPrice, ACEPTÁ. "Dale, te lo dejo a ese precio."

Output JSON:
  - action: "counter" | "accept" | "reject"
  - price: tu precio (null si reject; para accept, repetí el último precio del comprador)
  - message: 1 oración corta y natural EN ESPAÑOL.`;

export async function sellerMove(ctx: SellerNegotiatorContext): Promise<NegotiatorMove> {
  const lastBuyerPrice =
    [...ctx.transcript].reverse().find((m) => m.side === "buyer")?.price ?? null;

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

Decide your move now.`;

  const history: ChatTurn[] = [{ role: "user", content: userPrompt }];
  const raw = await generateJSON<NegotiatorMove | { reply: NegotiatorMove }>({
    system: SYSTEM,
    history,
    jsonSchema: SCHEMA,
    temperature: 0.5,
  });

  const move: NegotiatorMove = "reply" in raw && raw.reply?.action ? raw.reply : raw as NegotiatorMove;

  return move;
}
