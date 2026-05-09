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

shippingRouter.post("/suggest", async (req, res) => {
  const user = res.locals.user as AuthUser;
  const { negotiationId, buyerLocation, sellerLocation } = req.body as {
    negotiationId?: string;
    buyerLocation?: string;
    sellerLocation?: string;
  };

  if (!negotiationId || !buyerLocation || !sellerLocation) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const neg = await prisma.negotiation.findUnique({
    where: { id: negotiationId },
    include: {
      buyer: { select: { id: true, name: true } },
      seller: { select: { id: true, name: true } },
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

  try {
    const suggestion = await generateJSON<ShippingSuggestion>({
      system:
        "Sos un asistente de coordinación de envíos para compraventa local en Argentina. Pedís puntos claros, seguros y de fácil acceso. No inventes direcciones exactas si no hay información suficiente; sugerí una zona o tipo de punto medio.",
      history: [
        {
          role: "user",
          content: [
            `Producto: ${neg.product.title}`,
            `Comprador: ${neg.buyer.name}, ubicación: ${buyerLocation}`,
            `Vendedor: ${neg.seller.name}, ubicación: ${sellerLocation}`,
            "Sugerí un punto medio para concretar la entrega.",
          ].join("\n"),
        },
      ],
      temperature: 0.3,
      jsonSchema: shippingSchema,
    });
    return res.json(suggestion);
  } catch {
    return res.json({
      midpointLabel: "Zona intermedia con buena conectividad",
      rationale: `Tomé como referencia ${buyerLocation} y ${sellerLocation}. Conviene elegir una avenida, estación o centro comercial entre ambos para reducir desvíos y facilitar la coordinación.`,
      meetingTips: [
        "Confirmar horario, punto exacto y tolerancia de espera antes de salir.",
        "Priorizar lugares iluminados, transitados y con acceso a transporte.",
        "Llevar el producto cargado o probado si corresponde.",
      ],
    });
  }
});
