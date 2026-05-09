/**
 * Scrape Facebook Marketplace (Buenos Aires) for listings across categories
 * and dump them to data/fb-marketplace-<timestamp>.json.
 *
 * One-time scrape for hackathon demo seed. Pair with `seed:fb` to import.
 *
 * Usage:
 *   pnpm --filter api scrape:fb
 *
 * Env:
 *   FB_LOCATION       e.g. "buenosaires" (default)
 *   FB_CATEGORIES     comma-separated slugs; defaults to a sensible set
 *   FB_MAX_PER_CAT    max listings per category (default 40)
 *   FB_HEADED         "1" to run with a visible browser (default headless)
 *
 * No login required: Marketplace renders public listings before the login
 * dialog overlays the page. We dismiss that dialog if it appears and read
 * the anchors directly from the DOM.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

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

const LOCATION = process.env.FB_LOCATION ?? "buenosaires";
const MAX_PER_CAT = Number(process.env.FB_MAX_PER_CAT ?? 40);
const DEFAULT_CATEGORIES = [
  "vehicles",
  "electronics",
  "apparel",
  "home-goods",
  "musical-instruments",
  "sporting-goods",
  "toys-games",
];
const CATEGORIES = (process.env.FB_CATEGORIES ?? DEFAULT_CATEGORIES.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT, "data");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parsePrice(raw: string): { price: number | null; currency: string | null } {
  if (!raw) return { price: null, currency: null };
  const lower = raw.toLowerCase();
  if (lower.includes("gratis") || lower.includes("free")) return { price: 0, currency: null };
  const currencyMatch = raw.match(/(US\$|U\$S|USD|ARS|\$)/i);
  const currency = currencyMatch ? currencyMatch[0].toUpperCase().replace("U$S", "USD") : null;
  const digits = raw.replace(/[^\d.,]/g, "");
  if (!digits) return { price: null, currency };
  // AR formatting uses "." as thousands sep and "," as decimal. Normalise.
  const normalised = digits.includes(",")
    ? digits.replace(/\./g, "").replace(",", ".")
    : digits.replace(/\./g, "");
  const n = Number(normalised);
  return { price: Number.isFinite(n) ? n : null, currency };
}

async function dismissLoginDialog(page: Page) {
  // FB throws a login modal over Marketplace after a short delay. The
  // listings are already rendered behind it — pressing Escape removes the
  // overlay so scrolling keeps loading more cards.
  try {
    await page.keyboard.press("Escape");
    const closeBtn = page.locator('div[role="dialog"] [aria-label="Cerrar"], div[role="dialog"] [aria-label="Close"]').first();
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeBtn.click({ timeout: 1000 }).catch(() => {});
    }
  } catch {
    // best-effort
  }
}

async function autoScroll(page: Page, rounds: number) {
  for (let i = 0; i < rounds; i++) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(1200);
    if (i === 1) await dismissLoginDialog(page);
  }
}

async function scrapeCategory(page: Page, category: string): Promise<ScrapedProduct[]> {
  const url = `https://www.facebook.com/marketplace/${LOCATION}/${category}/`;
  console.log(`[scrape] ${category} → ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(3500);
  await dismissLoginDialog(page);
  await autoScroll(page, 6);

  const raw = await page.$$eval('a[href*="/marketplace/item/"]', (anchors) => {
    const seen = new Set<string>();
    const out: { url: string; text: string; img: string | null }[] = [];
    for (const a of anchors as HTMLAnchorElement[]) {
      const href = a.href.split("?")[0];
      if (seen.has(href)) continue;
      seen.add(href);
      const img = a.querySelector("img");
      out.push({
        url: href,
        text: (a.innerText ?? "").trim(),
        img: img ? img.getAttribute("src") : null,
      });
    }
    return out;
  });

  const scrapedAt = new Date().toISOString();
  const listings: ScrapedProduct[] = [];
  for (const item of raw.slice(0, MAX_PER_CAT)) {
    const lines = item.text.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const priceLine = lines.find((l) => /\d/.test(l) && /(\$|usd|ars|gratis|free)/i.test(l)) ?? lines[0]!;
    const priceIdx = lines.indexOf(priceLine);
    const title = lines[priceIdx + 1] ?? lines.find((l, i) => i !== priceIdx) ?? "";
    const location = lines[priceIdx + 2] ?? null;
    const { price, currency } = parsePrice(priceLine);
    if (!title || price === null) continue;
    listings.push({
      category,
      url: item.url,
      title,
      priceRaw: priceLine,
      price,
      currency,
      location,
      imageUrl: item.img,
      scrapedAt,
    });
  }
  console.log(`[scrape] ${category}: ${listings.length} listings`);
  return listings;
}

async function main() {
  ensureDir(DATA_DIR);
  const headed = process.env.FB_HEADED === "1";
  const browser = await chromium.launch({ headless: !headed });
  try {
    const context = await browser.newContext({
      locale: "es-AR",
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    const all: ScrapedProduct[] = [];
    for (const cat of CATEGORIES) {
      try {
        const items = await scrapeCategory(page, cat);
        all.push(...items);
      } catch (err) {
        console.warn(`[scrape] ${cat} falló:`, (err as Error).message);
      }
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outFile = path.join(DATA_DIR, `fb-marketplace-${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ location: LOCATION, categories: CATEGORIES, listings: all }, null, 2));
    console.log(`\n[done] ${all.length} listings → ${outFile}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
