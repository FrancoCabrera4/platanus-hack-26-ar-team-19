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
const geminiEmbeddingModel = process.env.GEMINI_EMBEDDING_MODEL ?? "text-embedding-004";

const openAiClient = new OpenAI({ apiKey: openAiApiKey ?? "missing" });
const geminiClient = new GoogleGenerativeAI(geminiApiKey ?? "missing");

export function buildProductEmbeddingText(product: ProductEmbeddingInput): string {
  return [
    product.title,
    product.description,
    product.category ? `Category: ${product.category}` : null,
    product.condition ? `Condition: ${product.condition}` : null,
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
    const model = geminiClient.getGenerativeModel({ model: geminiEmbeddingModel });
    const response = await model.embedContent(text);
    return {
      values: normalizeDimensions(response.embedding.values),
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
  product: ProductEmbeddingInput,
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
