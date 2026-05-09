import { Prisma } from "@prisma/client";
import prisma from "@repo/db";
import { log } from "@repo/logger";
import { generateJSON } from "../llm/gemini";
import { embedText, toVectorLiteral } from "./embeddings";
import { verifyProductMatch } from "./vision";

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

interface ProductCandidate {
  id: string;
  title: string;
  description: string;
  category: string | null;
  imageUrl: string | null;
  askPrice: number;
  distance: number;
  similarity: number;
}

const DEFAULT_MIN_VECTOR_SIMILARITY = 0.3;

function minVectorSimilarity(): number {
  const configured = Number.parseFloat(process.env.MIN_MATCH_SIMILARITY ?? "");
  if (!Number.isFinite(configured)) return DEFAULT_MIN_VECTOR_SIMILARITY;
  return Math.min(Math.max(configured, 0), 1);
}

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
 * Step 2: LLM text re-rank for semantic relevance.
 * Step 3: Vision re-rank — verify product images actually match what the buyer wants.
 */
export async function findMatches(searchId: string, topN = 3): Promise<MatchCandidate[]> {
  const search = await prisma.buyerSearch.findUnique({ where: { id: searchId } });
  if (!search) throw new Error(`Search ${searchId} not found`);

  const ceiling = search.maxPrice * 1.2;
  const searchText = [
    search.query,
    search.requirements,
    search.category ? `Category: ${search.category}` : null,
    search.imageDescription ? `Visual: ${search.imageDescription}` : null,
  ].filter(Boolean).join("\n");
  const { values } = await embedText(searchText);
  const vector = toVectorLiteral(values);

  let candidates = await findVectorCandidates(vector, ceiling, search.category);

  if (candidates.length === 0 && search.category) {
    candidates = await findVectorCandidates(vector, ceiling, null);
  }

  if (candidates.length === 0) return [];
  if (candidates.length === 1) {
    return candidates.map((candidate) => ({
      productId: candidate.id,
      score: candidate.similarity,
      rationale: "Only candidate above the semantic similarity threshold.",
    }));
  }

  // Step 2: LLM text re-rank
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
        "considering both semantic relevance and price reasonableness. Return a score in [0,1] for each candidate. " +
        "Be strict: only score above 0.5 if the product is genuinely what the buyer is looking for.",
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
    log("Match scoring failed, falling back to vector similarity:", (err as Error).message);
    scored = {
      matches: candidates.map((c) => ({
        productId: c.id,
        score: c.similarity,
        rationale: "Fallback vector similarity score.",
      })),
    };
  }

  const validIds = new Set(candidates.map((c) => c.id));
  let textRanked = scored.matches
    .filter((m) => validIds.has(m.productId))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(topN * 2, 6));

  // Step 3: Vision re-rank — verify product images match the buyer's intent
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const buyerDescription = [
    search.query,
    search.requirements,
    search.imageDescription,
  ].filter(Boolean).join(". ");

  textRanked = await visionRerank(textRanked, candidateMap, buyerDescription);

  return textRanked.slice(0, topN);
}

async function visionRerank(
  matches: MatchCandidate[],
  candidateMap: Map<string, ProductCandidate>,
  buyerDescription: string,
): Promise<MatchCandidate[]> {
  const results: MatchCandidate[] = [];

  for (const match of matches) {
    const candidate = candidateMap.get(match.productId);
    if (!candidate?.imageUrl) {
      results.push(match);
      continue;
    }

    try {
      const visionResult = await verifyProductMatch(
        candidate.imageUrl,
        buyerDescription,
        candidate.title,
      );

      if (visionResult.matches) {
        results.push({
          ...match,
          score: match.score * (0.5 + visionResult.confidence * 0.5),
          rationale: `${match.rationale} | Vision: ${visionResult.reason}`,
        });
      } else {
        log(`Vision rejected "${candidate.title}": ${visionResult.reason}`);
        results.push({
          ...match,
          score: match.score * 0.2,
          rationale: `${match.rationale} | Vision rejected: ${visionResult.reason}`,
        });
      }
    } catch (err) {
      log("Vision rerank failed for", candidate.id, (err as Error).message);
      results.push(match);
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

async function findVectorCandidates(
  vector: string,
  ceiling: number,
  category: string | null,
): Promise<ProductCandidate[]> {
  const categoryFilter = category
    ? Prisma.sql`AND p."category" = ${category}`
    : Prisma.empty;

  const minimumSimilarity = minVectorSimilarity();
  const maximumDistance = 1 - minimumSimilarity;

  return prisma.$queryRaw<ProductCandidate[]>(Prisma.sql`
    WITH vector_candidates AS (
      SELECT
        p."id",
        p."title",
        p."description",
        p."category",
        p."imageUrl",
        p."askPrice",
        (pe."embedding" <=> ${vector}::vector) AS "distance"
      FROM "Product" p
      INNER JOIN "ProductEmbedding" pe ON pe."productId" = p."id"
      WHERE p."status" = 'active'
        AND p."askPrice" <= ${ceiling}
        ${categoryFilter}
    )
    SELECT
      "id",
      "title",
      "description",
      "category",
      "imageUrl",
      "askPrice",
      "distance",
      (1 - "distance") AS "similarity"
    FROM vector_candidates
    WHERE "distance" <= ${maximumDistance}
    ORDER BY "distance"
    LIMIT 25
  `);
}
