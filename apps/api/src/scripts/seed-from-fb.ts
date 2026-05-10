/**
 * Read the latest data/fb-marketplace-*.json and import its products into
 * the Postgres DB so the demo has a populated catalog. Idempotent: prior
 * fb-sourced sellers + products are wiped before insert.
 *
 * Usage:
 *   pnpm seed
 *   pnpm --filter api seed:fb
 *   pnpm --filter api seed:fb -- ./data/fb-marketplace-2026-05-09T....json
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import prisma from "@repo/db";
import { upsertProductEmbedding } from "../services/embeddings";

type ScrapedProduct = {
  category: string;
  url: string;
  title: string;
  priceRaw: string;
  price: number | null;
  priceARS?: number;
  currency: string | null;
  location: string | null;
  imageUrl: string | null;
  visionAnalysis?: string | null;
  scrapedAt: string;
};

type ScrapeFile = {
  location: string;
  categories: string[];
  listings: ScrapedProduct[];
};

type ProductSeedRow = {
  userId: string;
  title: string;
  description: string;
  category: string | null;
  condition: string | null;
  askPrice: number;
  negotiationStrategy: string;
  imageUrl: string | null;
  visionAnalysis: string | null;
};

const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const FB_SELLER_DOMAIN = "fb-seller.demo";
const SELLER_POOL_SIZE = 12;
const MIN_PRICE_ARS = Number(process.env.FB_MIN_PRICE_ARS ?? 200);
const MAX_PRICE_ARS = Number(process.env.FB_MAX_PRICE_ARS ?? 50_000_000);
const OUTLIER_Z_SCORE = Number(process.env.FB_OUTLIER_Z_SCORE ?? 3.5);
const OUTLIER_STDDEV_FACTOR = Number(process.env.FB_OUTLIER_STDDEV_FACTOR ?? 3);
const OUTLIER_MIN_SAMPLE = Number(process.env.FB_OUTLIER_MIN_SAMPLE ?? 8);

function pickInputFile(): string {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  if (!fs.existsSync(DATA_DIR)) throw new Error(`No existe ${DATA_DIR}. Corré scrape:fb primero.`);
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("fb-marketplace-") && f.endsWith(".json"))
    .map((f) => path.join(DATA_DIR, f))
    .sort();
  if (files.length === 0) throw new Error(`No hay fb-marketplace-*.json en ${DATA_DIR}.`);
  return files[files.length - 1]!;
}

async function ensureSellerPool() {
  const existing = await prisma.user.findMany({ where: { email: { endsWith: `@${FB_SELLER_DOMAIN}` } } });
  if (existing.length >= SELLER_POOL_SIZE) return existing.slice(0, SELLER_POOL_SIZE);
  const names = ["Lucía", "Mateo", "Sofía", "Tomás", "Valentina", "Joaquín", "Camila", "Benjamín", "Martina", "Lautaro", "Florencia", "Nicolás"];
  const created = [];
  for (let i = 0; i < SELLER_POOL_SIZE; i++) {
    const email = `seller${i + 1}@${FB_SELLER_DOMAIN}`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { name: names[i] ?? `Seller ${i + 1}`, email },
    });
    created.push(user);
  }
  return created;
}

// Detect "$14.000" or "USD 1,200" style strings — for some FB cards the parser
// reads the price into `title` and the real product name into `location`.
const PRICE_LIKE = /^\s*(US\$|U\$S|USD|ARS|\$)?\s*[\d.,]+\s*$/i;

function titleKey(title: string) {
  return title.toLocaleLowerCase("es-AR").replace(/\s+/g, " ").trim();
}

const USD_TO_ARS = Number(process.env.USD_TO_ARS ?? 1200);
const USD_THRESHOLD = 5000;

function toARS(price: number, currency: string | null): number {
  if (/^(?:US\$|USD)$/i.test(currency ?? "")) return Math.round(price * USD_TO_ARS);
  if (currency) return Math.round(price);
  if (price < USD_THRESHOLD) return Math.round(price * USD_TO_ARS);
  return price;
}

function deriveProductFields(item: ScrapedProduct) {
  const askPrice = item.priceARS ?? toARS(item.price ?? 0, item.currency);

  // Recover from the title/location swap in the raw scrape.
  let title = item.title;
  let location = item.location;
  if (PRICE_LIKE.test(title) && location && !PRICE_LIKE.test(location)) {
    title = location;
    location = null;
  }

  const description = [title, location ? `Ubicación: ${location}` : null, `Fuente: Facebook Marketplace (${item.url})`]
    .filter(Boolean)
    .join("\n");
  return {
    askPrice,
    description,
    title,
    negotiationStrategy: "Publicación importada de Facebook Marketplace; negociar de forma razonable alrededor del precio publicado.",
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], avg = average(values)): number {
  const variance = average(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function findPriceOutliers<T extends { askPrice: number }>(
  products: T[],
): { stats: { count: number; average: number; median: number; stdDev: number; lowerCutoff: number; upperCutoff: number }; outliers: T[] } | null {
  const prices = products.map((product) => product.askPrice).filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length < OUTLIER_MIN_SAMPLE) return null;

  const priceAverage = average(prices);
  const priceMedian = median(prices);
  const priceStdDev = standardDeviation(prices, priceAverage);
  const logPrices = prices.map((price) => Math.log(price));
  const logMedian = median(logPrices);
  const logMad = median(logPrices.map((price) => Math.abs(price - logMedian)));

  let lowerCutoff: number;
  let upperCutoff: number;
  let outliers: T[];
  if (logMad > 0) {
    lowerCutoff = Math.exp(logMedian - (OUTLIER_Z_SCORE * logMad) / 0.6745);
    upperCutoff = Math.exp(logMedian + (OUTLIER_Z_SCORE * logMad) / 0.6745);
    outliers = products.filter((product) => {
      const modifiedZScore = (0.6745 * Math.abs(Math.log(product.askPrice) - logMedian)) / logMad;
      return modifiedZScore > OUTLIER_Z_SCORE;
    });
  } else if (priceStdDev > 0) {
    lowerCutoff = Math.max(0, priceAverage - OUTLIER_STDDEV_FACTOR * priceStdDev);
    upperCutoff = priceAverage + OUTLIER_STDDEV_FACTOR * priceStdDev;
    outliers = products.filter((product) => product.askPrice < lowerCutoff || product.askPrice > upperCutoff);
  } else {
    lowerCutoff = priceMedian;
    upperCutoff = priceMedian;
    outliers = [];
  }

  return {
    stats: {
      count: prices.length,
      average: Math.round(priceAverage),
      median: Math.round(priceMedian),
      stdDev: Math.round(priceStdDev),
      lowerCutoff: Math.round(lowerCutoff),
      upperCutoff: Math.round(upperCutoff),
    },
    outliers,
  };
}

async function main() {
  const file = pickInputFile();
  console.log(`[seed:fb] leyendo ${file}`);
  const payload = JSON.parse(fs.readFileSync(file, "utf-8")) as ScrapeFile;
  const valid = payload.listings.filter((l) => l.price !== null && l.price > 0 && l.title.length > 2);
  console.log(`[seed:fb] ${valid.length}/${payload.listings.length} products con precio válido`);

  const sellers = await ensureSellerPool();
  const sellerIds = sellers.map((s) => s.id);

  // Wipe prior fb-sourced products so the seed is idempotent.
  const existingProducts = await prisma.product.findMany({
    where: { userId: { in: sellerIds } },
    select: { id: true },
  });
  const productIds = existingProducts.map((product) => product.id);
  await prisma.negotiationMessage.deleteMany({
    where: { negotiation: { productId: { in: productIds } } },
  });
  await prisma.negotiation.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.productEmbedding.deleteMany({ where: { productId: { in: productIds } } });
  const wiped = await prisma.product.deleteMany({ where: { userId: { in: sellerIds } } });
  console.log(`[seed:fb] borrados ${wiped.count} products previos`);

  const seenTitles = new Set<string>();
  const rows: ProductSeedRow[] = [];
  let duplicateTitles = 0;
  let priceRangeRejected = 0;
  for (const item of valid) {
    const { askPrice, description, title, negotiationStrategy } = deriveProductFields(item);
    if (!Number.isFinite(askPrice) || askPrice < MIN_PRICE_ARS || askPrice > MAX_PRICE_ARS) {
      priceRangeRejected += 1;
      continue;
    }

    const trimmedTitle = title.slice(0, 200).trim();
    const key = titleKey(trimmedTitle);
    if (!trimmedTitle || seenTitles.has(key)) {
      duplicateTitles += 1;
      continue;
    }
    seenTitles.add(key);

    const seller = sellers[rows.length % sellers.length]!;
    rows.push({
      userId: seller.id,
      title: trimmedTitle,
      description,
      category: item.category,
      condition: null,
      askPrice,
      negotiationStrategy,
      imageUrl: item.imageUrl,
      visionAnalysis: item.visionAnalysis ?? null,
    });
  }
  if (duplicateTitles > 0) {
    console.log(`[seed:fb] omitidos ${duplicateTitles} products con título duplicado`);
  }
  if (priceRangeRejected > 0) {
    console.log(
      `[seed:fb] omitidos ${priceRangeRejected} products fuera de rango (${MIN_PRICE_ARS}-${MAX_PRICE_ARS} ARS)`,
    );
  }

  if (rows.length === 0) {
    console.log("[seed:fb] nada para insertar.");
    return;
  }

  const insertedIds: string[] = [];
  const visionByProductId = new Map<string, string | null>();
  for (const row of rows) {
    let product;
    try {
      const { visionAnalysis, ...productData } = row;
      product = await prisma.product.create({ data: productData });
      visionByProductId.set(product.id, visionAnalysis);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        console.warn(`[seed:fb] omitido título ya existente: ${row.title}`);
        continue;
      }
      throw err;
    }
    insertedIds.push(product.id);
  }

  const importedProducts = await prisma.product.findMany({
    where: { id: { in: insertedIds } },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      condition: true,
      askPrice: true,
    },
  });
  const outlierAnalysis = findPriceOutliers(importedProducts);
  const outlierIds = outlierAnalysis?.outliers.map((product) => product.id) ?? [];
  if (outlierAnalysis) {
    console.log("[seed:fb] agregados precio:", outlierAnalysis.stats);
  } else {
    console.log(`[seed:fb] skip outlier cleanup: menos de ${OUTLIER_MIN_SAMPLE} products importados`);
  }

  if (outlierIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: outlierIds } } });
    console.log(`[seed:fb] borrados ${outlierIds.length} products outliers por precio`);
  }

  const productsForEmbeddings = importedProducts.filter((product) => !outlierIds.includes(product.id));
  for (const product of productsForEmbeddings) {
    await upsertProductEmbedding(product.id, {
      ...product,
      visionAnalysis: visionByProductId.get(product.id) ?? null,
    });
  }

  console.log(`[seed:fb] insertados ${productsForEmbeddings.length} products`);
  const byCat: Record<string, number> = {};
  for (const product of productsForEmbeddings) {
    if (!product.category) continue;
    byCat[product.category] = (byCat[product.category] ?? 0) + 1;
  }
  console.log("[seed:fb] por categoría:", byCat);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
