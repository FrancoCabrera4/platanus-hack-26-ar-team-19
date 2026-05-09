import type { NegotiatorMove } from "./seller-negotiator";

type Side = "buyer" | "seller";

const LOWBALL_WORDS = ["duro", "agresiv", "barato", "bajo", "estricto", "fijo"];
const FLEXIBLE_WORDS = ["flexible", "negociable", "escucho", "razonable"];
const URGENT_WORDS = ["urgente", "rapido", "rápido", "hoy", "liquidar"];

export interface PricePolicy {
  askPrice: number;
  maxPrice?: number;
  strategy?: string | null;
  transcript: { side: Side; price: number | null; message: string }[];
  turnsRemaining: number;
}

export function normalizeBuyerMove(
  move: NegotiatorMove,
  policy: PricePolicy,
): NegotiatorMove {
  const lastSeller = lastPrice(policy.transcript, "seller");
  const lastBuyer = lastPrice(policy.transcript, "buyer");
  const maxPrice = buyerCeiling(policy);
  const firstTurn = policy.transcript.length === 0;

  if (move.action === "accept") {
    if (lastSeller === null || lastSeller > maxPrice) {
      return buyerCounter(
        policy,
        "Se me va un poco de presupuesto, pero puedo acercarme a este número si te sirve.",
      );
    }
    if (policy.turnsRemaining > 1 && lastSeller > buyerWalkawayTarget(policy)) {
      return buyerCounter(
        policy,
        "Me interesa, aunque todavía estoy un poco lejos. ¿Podés mejorarme este precio?",
      );
    }
    return {
      action: "accept",
      price: roundARS(lastSeller),
      message: cleanMessage(move.message, "buyer", lastSeller),
    };
  }

  if (move.action === "reject") {
    return {
      action: "reject",
      price: null,
      message: cleanMessage(move.message, "buyer"),
    };
  }

  const action = firstTurn ? "open" : "counter";
  const proposed =
    typeof move.price === "number" ? move.price : buyerTarget(policy);
  const min = firstTurn
    ? openingFloor(policy)
    : Math.max(lastBuyer ?? 0, openingFloor(policy));
  const max = Math.min(maxPrice, lastSeller ?? maxPrice);
  const price = roundARS(clamp(proposed, min, max));

  return {
    action,
    price,
    message: cleanMessage(move.message, "buyer", price),
  };
}

export function normalizeSellerMove(
  move: NegotiatorMove,
  policy: PricePolicy,
): NegotiatorMove {
  const lastBuyer = lastPrice(policy.transcript, "buyer");
  const floor = sellerFloor(policy);

  if (move.action === "accept") {
    if (lastBuyer !== null && lastBuyer >= acceptanceFloor(policy)) {
      return {
        action: "accept",
        price: roundARS(lastBuyer),
        message: cleanMessage(move.message, "seller", lastBuyer),
      };
    }
    return sellerCounter(
      policy,
      "Gracias por la oferta. Puedo ajustar un poco, pero necesito quedar más cerca de este valor.",
    );
  }

  if (move.action === "reject") {
    if (
      lastBuyer !== null &&
      lastBuyer >= floor * 0.95 &&
      policy.turnsRemaining > 0
    ) {
      return sellerCounter(
        policy,
        "Estamos cerca. Te dejo una contraoferta razonable para cerrar.",
      );
    }
    return {
      action: "reject",
      price: null,
      message: cleanMessage(move.message, "seller"),
    };
  }

  const proposed =
    typeof move.price === "number" ? move.price : sellerTarget(policy);
  const min = Math.max(floor, lastBuyer ?? 0);
  const max = policy.askPrice;
  const price = roundARS(clamp(proposed, min, max));

  return {
    action: "counter",
    price,
    message: cleanMessage(move.message, "seller", price),
  };
}

export function buyerCounter(
  policy: PricePolicy,
  message: string,
): NegotiatorMove {
  return {
    action: policy.transcript.length === 0 ? "open" : "counter",
    price: buyerTarget(policy),
    message,
  };
}

export function sellerCounter(
  policy: PricePolicy,
  message: string,
): NegotiatorMove {
  return {
    action: "counter",
    price: sellerTarget(policy),
    message,
  };
}

function buyerTarget(policy: PricePolicy): number {
  const maxPrice = buyerCeiling(policy);
  const lastSeller = lastPrice(policy.transcript, "seller");
  const lastBuyer = lastPrice(policy.transcript, "buyer");
  const aggressive = hasAny(policy.strategy, LOWBALL_WORDS);
  const flexible =
    hasAny(policy.strategy, FLEXIBLE_WORDS) ||
    hasAny(policy.strategy, URGENT_WORDS);

  if (policy.transcript.length === 0) {
    const anchor =
      policy.askPrice * (aggressive ? 0.62 : flexible ? 0.76 : 0.7);
    return roundARS(Math.min(maxPrice, Math.max(openingFloor(policy), anchor)));
  }

  const ceiling = Math.min(maxPrice, lastSeller ?? maxPrice);
  const previous = lastBuyer ?? openingFloor(policy);
  const gap = Math.max(0, ceiling - previous);
  const step =
    gap * (policy.turnsRemaining <= 1 ? 0.75 : flexible ? 0.5 : 0.35);
  return roundARS(clamp(previous + step, previous, ceiling));
}

function buyerWalkawayTarget(policy: PricePolicy): number {
  const maxPrice = buyerCeiling(policy);
  const flexible =
    hasAny(policy.strategy, FLEXIBLE_WORDS) ||
    hasAny(policy.strategy, URGENT_WORDS);
  return maxPrice * (flexible ? 0.98 : 0.92);
}

function openingFloor(policy: PricePolicy): number {
  const maxPrice = buyerCeiling(policy);
  const floorFromAsk = policy.askPrice * 0.5;
  const floorFromBudget = maxPrice * 0.55;
  return roundARS(Math.min(maxPrice, Math.max(floorFromAsk, floorFromBudget)));
}

function buyerCeiling(policy: PricePolicy): number {
  return Math.min(policy.maxPrice ?? policy.askPrice, policy.askPrice);
}

function sellerTarget(policy: PricePolicy): number {
  const lastBuyer = lastPrice(policy.transcript, "buyer");
  const floor = sellerFloor(policy);
  const progress = 1 - policy.turnsRemaining / 8;
  const target =
    policy.askPrice - (policy.askPrice - floor) * clamp(progress, 0.15, 0.85);
  if (lastBuyer === null) return roundARS(target);
  return roundARS(
    clamp(Math.max(target, lastBuyer * 1.04), floor, policy.askPrice),
  );
}

function sellerFloor(policy: PricePolicy): number {
  if (hasAny(policy.strategy, [...LOWBALL_WORDS, "no bajo", "sin descuento"]))
    return roundARS(policy.askPrice * 0.9);
  if (hasAny(policy.strategy, URGENT_WORDS))
    return roundARS(policy.askPrice * 0.72);
  if (hasAny(policy.strategy, FLEXIBLE_WORDS))
    return roundARS(policy.askPrice * 0.78);
  return roundARS(policy.askPrice * 0.84);
}

function acceptanceFloor(policy: PricePolicy): number {
  const floor = sellerFloor(policy);
  if (policy.turnsRemaining <= 1) return floor * 0.97;
  return floor;
}

function cleanMessage(message: string, side: Side, price?: number): string {
  const forbidden =
    /(maxPrice|askPrice|negotiationStrategy|precio máximo|estrategia|ceiling|floor)/i;
  const tooLong = message.trim().split(/\s+/).length > 38;
  if (!message.trim() || forbidden.test(message) || tooLong) {
    if (side === "buyer") {
      return price
        ? `Me interesa y puedo avanzar si lo dejamos en $${formatARS(price)}.`
        : "Gracias, pero por ahora no me cierra el precio.";
    }
    return price
      ? `Gracias por la oferta. Puedo dejarlo en $${formatARS(price)} y cerramos.`
      : "Gracias, pero con ese valor prefiero no avanzar.";
  }
  return message.trim();
}

function lastPrice(
  transcript: PricePolicy["transcript"],
  side: Side,
): number | null {
  return [...transcript].reverse().find((m) => m.side === side)?.price ?? null;
}

function hasAny(value: string | null | undefined, words: string[]): boolean {
  const normalized = (value ?? "").toLowerCase();
  return words.some((word) => normalized.includes(word));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundARS(value: number): number {
  const abs = Math.abs(value);
  const step =
    abs >= 1_000_000
      ? 10_000
      : abs >= 100_000
        ? 5_000
        : abs >= 20_000
          ? 1_000
          : 500;
  return Math.round(value / step) * step;
}

function formatARS(value: number): string {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(
    roundARS(value),
  );
}
