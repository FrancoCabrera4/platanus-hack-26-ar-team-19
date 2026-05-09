/**
 * Read the latest data/fb-marketplace-*.json and import its listings into
 * the SQLite DB so the demo has a populated catalog. Idempotent: prior
 * fb-sourced sellers + listings are wiped before insert.
 *
 * Usage:
 *   pnpm --filter api seed:fb
 *   pnpm --filter api seed:fb -- ./data/fb-marketplace-2026-05-09T....json
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import prisma from "@repo/db";

type ScrapedListing = {
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
  listings: ScrapedListing[];
};

const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const FB_SELLER_DOMAIN = "fb-seller.demo";
const SELLER_POOL_SIZE = 12;

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
      create: { name: names[i] ?? `Seller ${i + 1}`, email, role: "seller" },
    });
    created.push(user);
  }
  return created;
}

// Detect "$14.000" or "USD 1,200" style strings — for some FB cards the parser
// reads the price into `title` and the real product name into `location`.
const PRICE_LIKE = /^\s*(US\$|U\$S|USD|ARS|\$)?\s*[\d.,]+\s*$/i;

function deriveListingFields(item: ScrapedListing) {
  const askPrice = item.price ?? 0;
  // Heuristic reservation prices since the scrape doesn't expose them.
  const minPrice = Math.round(askPrice * 0.8);
  const maxPrice = Math.round(askPrice * 1.15);

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
  return { askPrice, minPrice, maxPrice, description, title };
}

async function main() {
  const file = pickInputFile();
  console.log(`[seed:fb] leyendo ${file}`);
  const payload = JSON.parse(fs.readFileSync(file, "utf-8")) as ScrapeFile;
  const valid = payload.listings.filter((l) => l.price !== null && l.price > 0 && l.title.length > 2);
  console.log(`[seed:fb] ${valid.length}/${payload.listings.length} listings con precio válido`);

  const sellers = await ensureSellerPool();
  const sellerIds = sellers.map((s) => s.id);

  // Wipe prior fb-sourced listings so the seed is idempotent.
  const wiped = await prisma.listing.deleteMany({ where: { sellerId: { in: sellerIds } } });
  console.log(`[seed:fb] borrados ${wiped.count} listings previos`);

  const rows = valid.map((item, i) => {
    const seller = sellers[i % sellers.length]!;
    const { askPrice, minPrice, maxPrice, description, title } = deriveListingFields(item);
    return {
      sellerId: seller.id,
      title: title.slice(0, 200),
      description,
      category: item.category,
      condition: null,
      askPrice,
      minPrice,
      maxPrice,
      strategyNotes: null,
    };
  });

  if (rows.length === 0) {
    console.log("[seed:fb] nada para insertar.");
    return;
  }

  const result = await prisma.listing.createMany({ data: rows });
  console.log(`[seed:fb] insertados ${result.count} listings`);
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
