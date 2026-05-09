import { Router, type Router as RouterType } from "express";
import prisma from "@repo/db";
import { requireAuth, type AuthUser } from "../auth";
import { generateJSON } from "../llm/gemini";

export const shippingRouter: RouterType = Router();

shippingRouter.use(requireAuth);

const shippingSchema = {
  type: "object",
  properties: {
    midpointLabel: { type: "string" },
    rationale: { type: "string" },
    meetingTips: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["midpointLabel", "rationale", "meetingTips"],
  additionalProperties: false,
};

type ShippingSuggestion = {
  midpointLabel: string;
  rationale: string;
  meetingTips: string[];
};

type ShippingSuggestionResponse =
  Partial<ShippingSuggestion> & { reply?: Partial<ShippingSuggestion> };

function unwrapSuggestion(suggestion: ShippingSuggestionResponse): Partial<ShippingSuggestion> {
  if ("reply" in suggestion && suggestion.reply && typeof suggestion.reply === "object") {
    return suggestion.reply;
  }
  return suggestion;
}

function fallbackSuggestion(buyerLocation: string, sellerLocation: string): ShippingSuggestion {
  return {
    midpointLabel: "Zona intermedia con buena conectividad",
    rationale: `Tomé como referencia ${buyerLocation} y ${sellerLocation}. Conviene elegir una avenida, estación o centro comercial entre ambos para reducir desvíos y facilitar la coordinación.`,
    meetingTips: [
      "Confirmar horario, punto exacto y tolerancia de espera antes de salir.",
      "Priorizar lugares iluminados, transitados y con acceso a transporte.",
      "Llevar el producto cargado o probado si corresponde.",
    ],
  };
}

function normalizeSuggestion(
  suggestion: ShippingSuggestionResponse,
  buyerLocation: string,
  sellerLocation: string,
): ShippingSuggestion {
  const fallback = fallbackSuggestion(buyerLocation, sellerLocation);
  const rawSuggestion = unwrapSuggestion(suggestion);
  const rawTips = rawSuggestion.meetingTips;
  const meetingTips =
    Array.isArray(rawTips) && rawTips.length > 0
      ? rawTips.filter((tip) => typeof tip === "string" && tip.trim().length > 0)
      : fallback.meetingTips;

  return {
    midpointLabel: rawSuggestion.midpointLabel?.trim() || fallback.midpointLabel,
    rationale: rawSuggestion.rationale?.trim() || fallback.rationale,
    meetingTips: meetingTips.length > 0 ? meetingTips : fallback.meetingTips,
  };
}

const MOCK_SELLER_ZONES = [
  "Palermo, CABA",
  "Caballito, CABA",
  "Belgrano, CABA",
  "Villa Crespo, CABA",
  "San Telmo, CABA",
  "Vicente Lopez, Buenos Aires",
  "San Isidro, Buenos Aires",
  "Moron, Buenos Aires",
  "Quilmes, Buenos Aires",
  "Lanus, Buenos Aires",
  "Lomas de Zamora, Buenos Aires",
  "La Plata, Buenos Aires",
];

function stableMockZone(email: string | null | undefined) {
  const sellerMatch = email?.match(/^seller(\d+)@fb-seller\.demo$/i);
  if (sellerMatch?.[1]) {
    const index = (Number(sellerMatch[1]) - 1) % MOCK_SELLER_ZONES.length;
    return MOCK_SELLER_ZONES[index]!;
  }

  return null;
}

function resolveSellerLocation(neg: {
  seller: { email: string; location: string | null };
}) {
  return neg.seller.location ?? stableMockZone(neg.seller.email);
}

shippingRouter.post("/suggest", async (req, res) => {
  const user = res.locals.user as AuthUser;
  const { negotiationId, userLocation, buyerLocation, sellerLocation } = req.body as {
    negotiationId?: string;
    userLocation?: string;
    buyerLocation?: string;
    sellerLocation?: string;
  };

  if (!negotiationId || (!userLocation && (!buyerLocation || !sellerLocation))) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const neg = await prisma.negotiation.findUnique({
    where: { id: negotiationId },
    include: {
      buyer: { select: { id: true, name: true, email: true, location: true } },
      seller: { select: { id: true, name: true, email: true, location: true } },
      product: { select: { title: true } },
    },
  });

  if (!neg) return res.status(404).json({ error: "negotiation not found" });
  if (neg.buyerId !== user.id && neg.sellerId !== user.id) {
    return res.status(403).json({ error: "not_the_owner" });
  }
  if (neg.status !== "accepted") {
    return res.status(409).json({ error: "deal_not_accepted" });
  }

  // Return saved suggestion if one already exists
  if (neg.midpointLabel) {
    let meetingTips: string[] = [];
    try {
      meetingTips = JSON.parse(neg.midpointTips ?? "[]");
    } catch { meetingTips = []; }
    return res.json({
      midpointLabel: neg.midpointLabel,
      rationale: neg.midpointRationale ?? "",
      meetingTips,
    });
  }

  const resolvedBuyerLocation =
    userLocation && user.id === neg.buyerId
      ? userLocation
      : buyerLocation || neg.buyer.location;
  const resolvedSellerLocation =
    userLocation && user.id === neg.sellerId
      ? userLocation
      : sellerLocation || resolveSellerLocation(neg);

  if (!resolvedBuyerLocation || !resolvedSellerLocation) {
    return res.status(409).json({ error: "counterparty_location_missing" });
  }

  try {
    const suggestion = await generateJSON<ShippingSuggestion>({
      system:
        "Sos un asistente de coordinación de envíos para compraventa local en Argentina. Pedís puntos claros, seguros y de fácil acceso. No inventes direcciones exactas si no hay información suficiente; sugerí una zona o tipo de punto medio.",
      history: [
        {
          role: "user",
          content: [
            `Producto: ${neg.product.title}`,
            `Comprador: ${neg.buyer.name}, ubicación: ${resolvedBuyerLocation}`,
            `Vendedor: ${neg.seller.name}, ubicación: ${resolvedSellerLocation}`,
            "Sugerí un punto medio para concretar la entrega.",
          ].join("\n"),
        },
      ],
      temperature: 0.3,
      jsonSchema: shippingSchema,
    });
    const normalized = normalizeSuggestion(suggestion, resolvedBuyerLocation, resolvedSellerLocation);

    // Persist the suggestion on the negotiation
    await prisma.negotiation.update({
      where: { id: negotiationId },
      data: {
        midpointLabel: normalized.midpointLabel,
        midpointRationale: normalized.rationale,
        midpointTips: JSON.stringify(normalized.meetingTips),
      },
    });

    return res.json(normalized);
  } catch {
    const fb = fallbackSuggestion(resolvedBuyerLocation, resolvedSellerLocation);

    // Persist the fallback suggestion too
    await prisma.negotiation.update({
      where: { id: negotiationId },
      data: {
        midpointLabel: fb.midpointLabel,
        midpointRationale: fb.rationale,
        midpointTips: JSON.stringify(fb.meetingTips),
      },
    });

    return res.json(fb);
  }
});
