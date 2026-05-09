import { Prisma } from "@prisma/client";
import prisma from "@repo/db";
import { generateJSON } from "../llm/gemini";
import { log } from "@repo/logger";
import { embedText, toVectorLiteral } from "./embeddings";

export interface MatchCandidate {
  productId: string;
  score: number; // 0..1
  rationale: string;
}

interface ScoringInput {
  query: string;
  requirements?: string | null;
  category?: string | null;
  candidates: { id: string; title: string; description: string; category?: string | null; askPrice: number }[];
}

type ProductCandidate = {
  id: string;
  title: string;
  description: string;
  category: string | null;
  askPrice: number;
  distance: number | null;
};

const SCORING_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          productId: { type: "string" },
          score: { type: "number" },
          rationale: { type: "string" },
        },
        required: ["productId", "score", "rationale"],
      },
    },
  },
  required: ["matches"],
} as const;

/**
 * Find candidate products that could fulfill a buyer search.
 * Step 1: pgvector retrieval over product descriptions with coarse price/category filters.
 * Step 2: ask the LLM to re-rank semantic relevance and return top N.
 */
export async function findMatches(searchId: string, topN = 3): Promise<MatchCandidate[]> {
  const search = await prisma.buyerSearch.findUnique({ where: { id: searchId } });
  if (!search) throw new Error(`Search ${searchId} not found`);

  // 20% slack on max price — sellers may negotiate down.
  const ceiling = search.maxPrice * 1.2;
  const searchText = [
    search.query,
    search.requirements,
    search.category ? `Category: ${search.category}` : null,
  ].filter(Boolean).join("\n");
  const { values } = await embedText(searchText);
  const vector = toVectorLiteral(values);

  let candidates = await findVectorCandidates(vector, ceiling, search.category);

  // The buyer agent and seed sources don't always share category vocabulary.
  if (candidates.length === 0 && search.category) {
    candidates = await findVectorCandidates(vector, ceiling, null);
  }

  if (candidates.length === 0) {
    candidates = await prisma.product.findMany({
      where: { status: "active", askPrice: { lte: ceiling } },
      take: 25,
    }).then((products) => products.map((product) => ({ ...product, distance: null })));
  }

  if (candidates.length === 0) return [];
  if (candidates.length === 1) {
    return [{ productId: candidates[0]!.id, score: 0.6, rationale: "Only candidate available." }];
  }

  const scoringInput: ScoringInput = {
    query: search.query,
    requirements: search.requirements,
    category: search.category,
    candidates: candidates.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      category: c.category,
      askPrice: c.askPrice,
    })),
  };

  let scored: { matches: MatchCandidate[] };
  try {
    scored = await generateJSON<{ matches: MatchCandidate[] }>({
      system:
        "You are a matching engine for a marketplace. Score how well each product fits the buyer's request, " +
        "considering both semantic relevance and price reasonableness. Return a score in [0,1] for each candidate.",
      history: [
        {
          role: "user",
          content: `Buyer wants:\n${JSON.stringify(scoringInput, null, 2)}\n\nReturn matches sorted by score descending.`,
        },
      ],
      jsonSchema: SCORING_SCHEMA,
      temperature: 0.2,
    });
  } catch (err) {
    log("Match scoring failed, falling back to price-only ranking:", (err as Error).message);
    scored = {
      matches: candidates.map((c) => ({
        productId: c.id,
        score: c.distance == null
          ? 1 - Math.abs(c.askPrice - search.maxPrice) / Math.max(search.maxPrice, 1)
          : Math.max(0, 1 - c.distance),
        rationale: c.distance == null
          ? "Fallback price-distance score."
          : "Fallback vector similarity score.",
      })),
    };
  }

  // Defensive: keep only candidates we actually queried.
  const validIds = new Set(candidates.map((c) => c.id));
  return scored.matches
    .filter((m) => validIds.has(m.productId))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

async function findVectorCandidates(
  vector: string,
  ceiling: number,
  category: string | null,
): Promise<ProductCandidate[]> {
  const categoryFilter = category
    ? Prisma.sql`AND p."category" = ${category}`
    : Prisma.empty;

  return prisma.$queryRaw<ProductCandidate[]>(Prisma.sql`
    SELECT
      p."id",
      p."title",
      p."description",
      p."category",
      p."askPrice",
      (pe."embedding" <=> ${vector}::vector) AS "distance"
    FROM "Product" p
    INNER JOIN "ProductEmbedding" pe ON pe."productId" = p."id"
    WHERE p."status" = 'active'
      AND p."askPrice" <= ${ceiling}
      ${categoryFilter}
    ORDER BY pe."embedding" <=> ${vector}::vector
    LIMIT 25
  `);
}
