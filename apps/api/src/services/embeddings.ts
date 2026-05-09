import { createHash, randomUUID } from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { Prisma } from "@prisma/client";
import prisma from "@repo/db";
import { log } from "@repo/logger";

export const EMBEDDING_DIMENSIONS = 1536;

type ProductEmbeddingInput = {
  title: string;
  description: string;
  category?: string | null;
  condition?: string | null;
};

const openAiApiKey = process.env.OPENAI_API_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
const openAiEmbeddingModel = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const geminiEmbeddingModel = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";

const openAiClient = new OpenAI({ apiKey: openAiApiKey ?? "missing" });
const geminiClient = new GoogleGenerativeAI(geminiApiKey ?? "missing");

const GEMINI_MIN_GAP_MS = Number(process.env.GEMINI_EMBED_MIN_GAP_MS ?? 6500);
const GEMINI_MAX_RETRIES = 5;
let lastGeminiEmbedAt = 0;
let geminiQueue: Promise<unknown> = Promise.resolve();

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status === 429 || status === 503) return true;
  const msg = (err as { message?: string }).message ?? "";
  return /quota|rate.?limit|exhausted|overloaded/i.test(msg);
}

async function geminiEmbedThrottled(text: string): Promise<number[]> {
  const run = (async () => {
    const wait = GEMINI_MIN_GAP_MS - (Date.now() - lastGeminiEmbedAt);
    if (wait > 0) await sleep(wait);

    const model = geminiClient.getGenerativeModel({ model: geminiEmbeddingModel });
    let attempt = 0;
    for (;;) {
      try {
        const response = await model.embedContent(text);
        lastGeminiEmbedAt = Date.now();
        return response.embedding.values;
      } catch (err) {
        if (!isRateLimitError(err) || attempt >= GEMINI_MAX_RETRIES) throw err;
        const backoff = Math.min(60000, 1000 * 2 ** attempt);
        log(`[embeddings] Gemini rate limit hit, retrying in ${backoff}ms (attempt ${attempt + 1}/${GEMINI_MAX_RETRIES})`);
        await sleep(backoff);
        attempt += 1;
      }
    }
  })();

  const previous = geminiQueue;
  geminiQueue = previous.then(() => run).catch(() => undefined);
  await previous.catch(() => undefined);
  return run;
}

export function buildProductEmbeddingText(product: ProductEmbeddingInput & { visionAnalysis?: string | null }): string {
  return [
    product.title,
    product.description,
    product.category ? `Category: ${product.category}` : null,
    product.condition ? `Condition: ${product.condition}` : null,
    product.visionAnalysis ? `Visual: ${product.visionAnalysis}` : null,
  ].filter(Boolean).join("\n");
}

function normalizeDimensions(values: number[]): number[] {
  if (values.length === EMBEDDING_DIMENSIONS) return values;
  if (values.length > EMBEDDING_DIMENSIONS) return values.slice(0, EMBEDDING_DIMENSIONS);
  return [...values, ...Array.from({ length: EMBEDDING_DIMENSIONS - values.length }, () => 0)];
}

function fallbackEmbedding(text: string): number[] {
  const values = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const words = text.toLowerCase().match(/[a-z0-9áéíóúñü]+/gi) ?? [];

  for (const word of words) {
    const hash = createHash("sha256").update(word).digest();
    const index = hash.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
    values[index] += hash[4]! % 2 === 0 ? 1 : -1;
  }

  const norm = Math.hypot(...values) || 1;
  return values.map((value) => value / norm);
}

export async function embedText(text: string): Promise<{ values: number[]; model: string }> {
  if (openAiApiKey) {
    const response = await openAiClient.embeddings.create({
      model: openAiEmbeddingModel,
      input: text,
    });
    return {
      values: normalizeDimensions(response.data[0]?.embedding ?? []),
      model: openAiEmbeddingModel,
    };
  }

  if (geminiApiKey) {
    const values = await geminiEmbedThrottled(text);
    return {
      values: normalizeDimensions(values),
      model: geminiEmbeddingModel,
    };
  }

  log("WARN: no embedding API key set; using deterministic local embeddings.");
  return { values: fallbackEmbedding(text), model: "local-hash-v1" };
}

export function toVectorLiteral(values: number[]): string {
  return `[${normalizeDimensions(values).join(",")}]`;
}

export async function upsertProductEmbedding(
  productId: string,
  product: ProductEmbeddingInput & { visionAnalysis?: string | null },
): Promise<void> {
  const text = buildProductEmbeddingText(product);
  const { values, model } = await embedText(text);
  const vector = toVectorLiteral(values);
  const id = randomUUID();

  await prisma.$executeRaw`
    INSERT INTO "ProductEmbedding" ("id", "productId", "embedding", "text", "model", "createdAt", "updatedAt")
    VALUES (${id}, ${productId}, ${vector}::vector, ${text}, ${model}, NOW(), NOW())
    ON CONFLICT ("productId")
    DO UPDATE SET
      "embedding" = EXCLUDED."embedding",
      "text" = EXCLUDED."text",
      "model" = EXCLUDED."model",
      "updatedAt" = NOW()
  `;
}

export function productVectorDistanceSql(vector: string) {
  return Prisma.sql`pe.embedding <=> ${vector}::vector`;
}
