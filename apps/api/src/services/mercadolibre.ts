import { log } from "@repo/logger";

export interface MLProduct {
  id: string;
  title: string;
  price: number;
  currency: string;
  condition: string;
  imageUrl: string | null;
  permalink: string;
}

export interface MLPriceRef {
  min: number;
  max: number;
  median: number;
  avg: number;
  count: number;
  products: MLProduct[];
}

const ML_API = "https://api.mercadolibre.com";
const SITE = "MLA"; // Argentina

export async function searchMercadoLibre(
  query: string,
  limit = 10,
): Promise<MLProduct[]> {
  try {
    const url = `${ML_API}/sites/${SITE}/search?q=${encodeURIComponent(query)}&limit=${limit}&sort=relevance`;
    const res = await fetch(url);
    if (!res.ok) {
      log("MercadoLibre API error:", res.status);
      return [];
    }
    const data = await res.json() as {
      results: {
        id: string;
        title: string;
        price: number;
        currency_id: string;
        condition: string;
        thumbnail: string;
        permalink: string;
      }[];
    };

    return data.results.map((r) => ({
      id: r.id,
      title: r.title,
      price: r.price,
      currency: r.currency_id,
      condition: r.condition,
      imageUrl: r.thumbnail?.replace("http://", "https://") ?? null,
      permalink: r.permalink,
    }));
  } catch (err) {
    log("MercadoLibre search failed:", (err as Error).message);
    return [];
  }
}

export async function getPriceReference(query: string): Promise<MLPriceRef | null> {
  const products = await searchMercadoLibre(query, 20);
  if (products.length === 0) return null;

  const prices = products.map((p) => p.price).sort((a, b) => a - b);
  const sum = prices.reduce((a, b) => a + b, 0);

  return {
    min: prices[0]!,
    max: prices[prices.length - 1]!,
    median: prices[Math.floor(prices.length / 2)]!,
    avg: Math.round(sum / prices.length),
    count: prices.length,
    products: products.slice(0, 5),
  };
}
