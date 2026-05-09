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
  candidates: {
    id: string;
    title: string;
    description: string;
    category?: string | null;
    askPrice: number;
  }[];
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
const DEFAULT_MIN_LLM_MATCH_SCORE = 0.5;
<<<<<<< HEAD
const MAX_CANDIDATES = 25;
const FALLBACK_VECTOR_CANDIDATES = 10;
const STOP_WORDS = new Set([
  "con",
  "del",
  "el",
  "la",
  "las",
  "los",
  "para",
  "por",
  "que",
  "una",
  "uno",
]);
=======
>>>>>>> UriGandel

function minVectorSimilarity(): number {
  const configured = Number.parseFloat(process.env.MIN_MATCH_SIMILARITY ?? "");
  if (!Number.isFinite(configured)) return DEFAULT_MIN_VECTOR_SIMILARITY;
  return Math.min(Math.max(configured, 0), 1);
}

function minLlmMatchScore(): number {
  const configured = Number.parseFloat(process.env.MIN_LLM_MATCH_SCORE ?? "");
  if (!Number.isFinite(configured)) return DEFAULT_MIN_LLM_MATCH_SCORE;
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
export async function findMatches(
  searchId: string,
  topN = 3,
): Promise<MatchCandidate[]> {
  const search = await prisma.buyerSearch.findUnique({
    where: { id: searchId },
  });
  if (!search) throw new Error(`Search ${searchId} not found`);

  const ceiling = search.maxPrice * 1.2;
  const category = normalizeCategory(search.category);
  const searchText = [
    search.query,
    search.requirements,
    category ? `Category: ${category}` : null,
    search.imageDescription ? `Visual: ${search.imageDescription}` : null,
  ].filter(Boolean).join("\n");
  const { values } = await embedText(searchText);
  const vector = toVectorLiteral(values);

  let candidates = mergeCandidates(
    await findCandidatesWithCategoryFallback(category, (candidateCategory) =>
      findVectorCandidates(vector, ceiling, candidateCategory),
    ),
    await findCandidatesWithCategoryFallback(category, (candidateCategory) =>
      findLexicalCandidates(
        search.query,
        search.requirements,
        ceiling,
        candidateCategory,
      ),
    ),
  );

  if (candidates.length === 0) {
    candidates = await findNearestVectorCandidates(vector, ceiling);
  }

  if (candidates.length === 0) return [];
  if (candidates.length === 1) {
    const only = candidates[0]!;
    if (only.similarity < minLlmMatchScore()) return [];
    return [{
      productId: only.id,
      score: only.similarity,
      rationale: "Only candidate above the semantic similarity threshold.",
    }];
  }

  // Step 2: LLM text re-rank
  const scoringInput: ScoringInput = {
    query: search.query,
    requirements: search.requirements,
    category,
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
    log(
      "Match scoring failed, falling back to vector similarity:",
      (err as Error).message,
    );
    scored = {
      matches: candidates.map((c) => ({
        productId: c.id,
        score: c.similarity,
        rationale: "Fallback vector similarity score.",
      })),
    };
  }

  const validIds = new Set(candidates.map((c) => c.id));
  const minScore = minLlmMatchScore();
<<<<<<< HEAD
  let textRanked = scored.matches
=======
  return scored.matches
>>>>>>> UriGandel
    .filter((m) => validIds.has(m.productId))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(topN * 2, 6));

  if (textRanked.length === 0) {
    log(
      "Match scoring returned no usable candidates; falling back to retrieval scores.",
    );
    return candidatesToMatches(candidates).slice(0, topN);
  }

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
    LIMIT ${MAX_CANDIDATES}
  `);
}

async function findNearestVectorCandidates(
  vector: string,
  ceiling: number,
): Promise<ProductCandidate[]> {
  return prisma.$queryRaw<ProductCandidate[]>(Prisma.sql`
    SELECT
      p."id",
      p."title",
      p."description",
      p."category",
      p."imageUrl",
      p."askPrice",
      (pe."embedding" <=> ${vector}::vector) AS "distance",
      (1 - (pe."embedding" <=> ${vector}::vector)) AS "similarity"
    FROM "Product" p
    INNER JOIN "ProductEmbedding" pe ON pe."productId" = p."id"
    WHERE p."status" = 'active'
      AND p."askPrice" <= ${ceiling}
    ORDER BY "distance"
    LIMIT ${FALLBACK_VECTOR_CANDIDATES}
  `);
}

async function findLexicalCandidates(
  query: string,
  requirements: string | null,
  ceiling: number,
  category: string | null,
): Promise<ProductCandidate[]> {
  const terms = searchTerms(query, requirements);
  if (terms.length === 0) return [];

  const patterns = terms.map((term) => `%${escapeLike(term)}%`);
  const termPredicates = patterns.map(
    (pattern) =>
      Prisma.sql`p."title" ILIKE ${pattern} ESCAPE '\\' OR p."description" ILIKE ${pattern} ESCAPE '\\'`,
  );
  const termHitScores = patterns.map(
    (pattern) =>
      Prisma.sql`CASE WHEN p."title" ILIKE ${pattern} ESCAPE '\\' OR p."description" ILIKE ${pattern} ESCAPE '\\' THEN 1 ELSE 0 END`,
  );
  const categoryFilter = category
    ? Prisma.sql`AND p."category" = ${category}`
    : Prisma.empty;

  return prisma.$queryRaw<ProductCandidate[]>(Prisma.sql`
    WITH lexical_candidates AS (
      SELECT
        p."id",
        p."title",
        p."description",
        p."category",
        p."imageUrl",
        p."askPrice",
        (${Prisma.join(termHitScores, " + ")})::float AS "termHits"
      FROM "Product" p
      WHERE p."status" = 'active'
        AND p."askPrice" <= ${ceiling}
        ${categoryFilter}
        AND (${Prisma.join(termPredicates, " OR ")})
    )
    SELECT
      "id",
      "title",
      "description",
      "category",
      "imageUrl",
      "askPrice",
      1 - LEAST(0.95, 0.35 + ("termHits" / ${terms.length}) * 0.55) AS "distance",
      LEAST(0.95, 0.35 + ("termHits" / ${terms.length}) * 0.55) AS "similarity"
    FROM lexical_candidates
    ORDER BY "similarity" DESC, "askPrice" ASC
    LIMIT ${MAX_CANDIDATES}
  `);
}

async function findCandidatesWithCategoryFallback(
  category: string | null,
  findCandidates: (category: string | null) => Promise<ProductCandidate[]>,
): Promise<ProductCandidate[]> {
  const candidates = await findCandidates(category);

  // The buyer agent and seed sources don't always share category vocabulary.
  if (candidates.length === 0 && category) {
    return findCandidates(null);
  }

  return candidates;
}

function mergeCandidates(
  ...candidateGroups: ProductCandidate[][]
): ProductCandidate[] {
  const byId = new Map<string, ProductCandidate>();

  for (const candidate of candidateGroups.flat()) {
    const existing = byId.get(candidate.id);
    if (!existing || candidate.similarity > existing.similarity) {
      byId.set(candidate.id, candidate);
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_CANDIDATES);
}

function candidatesToMatches(candidates: ProductCandidate[]): MatchCandidate[] {
  return candidates.map((candidate) => ({
    productId: candidate.id,
    score: candidate.similarity,
    rationale: "Fallback retrieval score.",
  }));
}

function normalizeCategory(category: string | null): string | null {
  const trimmed = category?.trim();
  return trimmed ? trimmed : null;
}

function searchTerms(query: string, requirements: string | null): string[] {
  const terms =
    [query, requirements]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .match(/[a-z0-9áéíóúñü]+/gi) ?? [];

  return Array.from(
    new Set(terms.filter((term) => term.length >= 3 && !STOP_WORDS.has(term))),
  ).slice(0, 8);
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}
