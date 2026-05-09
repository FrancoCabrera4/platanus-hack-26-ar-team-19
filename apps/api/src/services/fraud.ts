import prisma from "@repo/db";
import { log } from "@repo/logger";
import { getPriceReference } from "./mercadolibre";

export interface FraudFlag {
  rule: string;
  severity: "block" | "warn";
}

export interface FraudResult {
  safe: boolean;
  flags: FraudFlag[];
}

const SCAM_KEYWORDS = [
  "whatsapp", "whatssap", "wsp", "telegram",
  "depositar antes", "transferir antes", "pago anticipado",
  "enviar dinero", "giro", "western union",
  "no hago envíos", "solo efectivo", "mp antes",
  "ganador", "sorteo", "premio",
  "urgente vendo", "regalo", "gratis",
];

const PRICE_LIKE_TITLE = /^\s*\$?\s*[\d.,]+\s*$/;
const MIN_DESCRIPTION_LENGTH = 10;
const ABSOLUTE_MIN_PRICE = 1000;
const CATEGORY_PRICE_FLOOR_PCT = 0.15;

let categoryAvgCache: Map<string, number> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getCategoryAverages(): Promise<Map<string, number>> {
  if (categoryAvgCache && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return categoryAvgCache;
  }

  const rows = await prisma.$queryRaw<{ category: string; avg: number }[]>`
    SELECT "category", AVG("askPrice") as avg
    FROM "Product"
    WHERE "status" = 'active' AND "category" IS NOT NULL
    GROUP BY "category"
    HAVING COUNT(*) >= 5
  `;

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.category.toLowerCase(), Number(row.avg));
  }

  categoryAvgCache = map;
  cacheTimestamp = Date.now();
  return map;
}

export async function checkProduct(product: {
  title: string;
  description: string;
  askPrice: number;
  category: string | null;
  userId: string;
}): Promise<FraudResult> {
  const flags: FraudFlag[] = [];

  if (product.askPrice < ABSOLUTE_MIN_PRICE) {
    flags.push({ rule: "price_too_low", severity: "block" });
  }

  if (product.category) {
    const avgs = await getCategoryAverages();
    const avg = avgs.get(product.category.toLowerCase());
    if (avg && product.askPrice < avg * CATEGORY_PRICE_FLOOR_PCT) {
      flags.push({ rule: "price_below_category_avg", severity: "block" });
    }
  }

  if (PRICE_LIKE_TITLE.test(product.title)) {
    flags.push({ rule: "title_is_price", severity: "warn" });
  }

  if (product.description.length < MIN_DESCRIPTION_LENGTH) {
    flags.push({ rule: "description_too_short", severity: "warn" });
  }

  const lowerText = `${product.title} ${product.description}`.toLowerCase();
  for (const keyword of SCAM_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      flags.push({ rule: `scam_keyword:${keyword}`, severity: "block" });
      break;
    }
  }

  const duplicate = await prisma.product.findFirst({
    where: {
      title: product.title,
      userId: { not: product.userId },
      status: "active",
    },
    select: { id: true },
  });
  if (duplicate) {
    flags.push({ rule: "duplicate_title_other_seller", severity: "warn" });
  }

  const hasBlock = flags.some((f) => f.severity === "block");

  if (flags.length > 0) {
    log(`[fraud] Product "${product.title}" flagged: ${flags.map((f) => f.rule).join(", ")} → ${hasBlock ? "BLOCKED" : "WARN"}`);
  }

  return {
    safe: !hasBlock,
    flags,
  };
}

export function checkCandidates<T extends { id: string; title: string; description: string; askPrice: number; category: string | null }>(
  candidates: T[],
  categoryAverages: Map<string, number>,
): { passed: T[]; blocked: T[] } {
  const passed: T[] = [];
  const blocked: T[] = [];

  for (const c of candidates) {
    const flags: string[] = [];

    if (c.askPrice < ABSOLUTE_MIN_PRICE) {
      flags.push("price_too_low");
    }

    if (c.category) {
      const avg = categoryAverages.get(c.category.toLowerCase());
      if (avg && c.askPrice < avg * CATEGORY_PRICE_FLOOR_PCT) {
        flags.push("price_below_category_avg");
      }
    }

    const lowerText = `${c.title} ${c.description}`.toLowerCase();
    for (const keyword of SCAM_KEYWORDS) {
      if (lowerText.includes(keyword)) {
        flags.push(`scam_keyword`);
        break;
      }
    }

    if (PRICE_LIKE_TITLE.test(c.title)) {
      flags.push("title_is_price");
    }

    if (flags.length > 0) {
      log(`[fraud] Candidate "${c.title}" blocked: ${flags.join(", ")}`);
      blocked.push(c);
    } else {
      passed.push(c);
    }
  }

  return { passed, blocked };
}

/**
 * Deep price verification against MercadoLibre.
 * If the product's price is suspiciously low vs market (< 30% of ML median),
 * it's likely a scam. Returns null if ML has no data.
 */
export async function verifyPriceWithMarket(
  title: string,
  askPrice: number,
): Promise<{ suspicious: boolean; reason: string; marketMedian?: number } | null> {
  try {
    const mlRef = await getPriceReference(title);
    if (!mlRef || mlRef.count < 3) return null;

    const ratio = askPrice / mlRef.median;

    if (ratio < 0.3) {
      return {
        suspicious: true,
        reason: `Precio $${askPrice.toLocaleString("es-AR")} es ${Math.round(ratio * 100)}% del precio de mercado (mediana: $${mlRef.median.toLocaleString("es-AR")})`,
        marketMedian: mlRef.median,
      };
    }

    if (ratio < 0.5) {
      log(`[fraud] Price warning for "${title}": $${askPrice} is ${Math.round(ratio * 100)}% of market median $${mlRef.median}`);
    }

    return { suspicious: false, reason: "Precio dentro del rango de mercado", marketMedian: mlRef.median };
  } catch (err) {
    log("[fraud] ML price check failed:", (err as Error).message);
    return null;
  }
}

export { getCategoryAverages };
