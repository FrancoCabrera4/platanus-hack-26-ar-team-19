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
  currency: string | null;
  location: string | null;
  imageUrl: string | null;
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
};

const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const FB_SELLER_DOMAIN = "fb-seller.demo";
const SELLER_POOL_SIZE = 12;
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
    const location = MOCK_SELLER_ZONES[i]!;
    const user = await prisma.user.upsert({
      where: { email },
      update: { location },
      create: {
        name: names[i] ?? `Seller ${i + 1}`,
        email,
        location,
      },
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

function toARS(price: number): number {
  if (price < USD_THRESHOLD) return Math.round(price * USD_TO_ARS);
  return price;
}

function deriveProductFields(item: ScrapedProduct) {
  const askPrice = toARS(item.price ?? 0);

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
  for (const item of valid) {
    const { askPrice, description, title, negotiationStrategy } = deriveProductFields(item);
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
    });
  }
  if (duplicateTitles > 0) {
    console.log(`[seed:fb] omitidos ${duplicateTitles} products con título duplicado`);
  }

  if (rows.length === 0) {
    console.log("[seed:fb] nada para insertar.");
    return;
  }

  let count = 0;
  for (const row of rows) {
    let product;
    try {
      product = await prisma.product.create({ data: row });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        console.warn(`[seed:fb] omitido título ya existente: ${row.title}`);
        continue;
      }
      throw err;
    }
    await upsertProductEmbedding(product.id, product);
    count += 1;
  }

  console.log(`[seed:fb] insertados ${count} products`);
  const byCat: Record<string, number> = {};
  for (const r of rows) byCat[r.category!] = (byCat[r.category!] ?? 0) + 1;
  console.log("[seed:fb] por categoría:", byCat);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
