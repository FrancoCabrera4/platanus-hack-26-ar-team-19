import { Prisma } from "@prisma/client";
import prisma from "@repo/db";
import { log } from "@repo/logger";
import { generateJSON } from "../llm/gemini";
import { embedText, toVectorLiteral } from "./embeddings";
import { verifyProductMatch } from "./vision";
import {
  checkCandidates,
  getCategoryAverages,
  verifyPriceWithMarket,
} from "./fraud";

export type MatchQuality = "exact" | "close" | "approximate";

export interface MatchCandidate {
  productId: string;
  score: number; // 0..1
  rationale: string;
  matchQuality: MatchQuality;
}

/** Row returned by {@link findMatches} — embedding/lexical retrieval only (no LLM re-rank). */
export interface RetrievalMatch {
  id: string;
  title: string;
  description: string;
  category: string | null;
  askPrice: number;
  vectorSimilarity: number;
}

function classifyMatchQuality(score: number): MatchQuality {
  if (score >= 0.9) return "exact";
  if (score >= 0.75) return "close";
  return "approximate";
}

interface ScoringInput {
  query: string;
  expandedQuery?: string;
  requirements?: string | null;
  category?: string | null;
  maxPrice: number;
  negotiationStrategy?: string | null;
  imageDescription?: string | null;
  candidates: {
    id: string;
    title: string;
    description: string;
    category?: string | null;
    askPrice: number;
    vectorSimilarity: number;
  }[];
}

/** Raw LLM re-rank output (before price adjustment and matchQuality mapping). */
interface LlmScoringResponse {
  matches: {
    productId: string;
    score: number;
    rationale: string;
    isExactMatch?: boolean;
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

const DEFAULT_MIN_VECTOR_SIMILARITY = 0.25;
const DEFAULT_MIN_LLM_MATCH_SCORE = 0.5;
const MAX_CANDIDATES = 30;
const FALLBACK_VECTOR_CANDIDATES = 15;
const VISION_CONCURRENCY = 5;
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
  "busco",
  "quiero",
  "necesito",
]);

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

// --- Query expansion ---

const EXPANSION_SCHEMA = {
  type: "object",
  properties: {
    expanded: {
      type: "string",
      description: "Expanded search text with synonyms and related terms",
    },
    inferredCategory: { type: "string", description: "Best matching category" },
  },
  required: ["expanded"],
} as const;

async function expandQuery(
  query: string,
  requirements?: string | null,
  category?: string | null,
): Promise<{ expanded: string; inferredCategory: string | null }> {
  try {
    const result = await generateJSON<{
      expanded: string;
      inferredCategory?: string;
    }>({
      system: `You are a search query expander for an Argentine marketplace. Given a buyer's search query, expand it with:
- Spanish synonyms and common variations (e.g. "campera" → "campera jacket abrigo chamarra")
- Brand name variations (e.g. "North Face" → "North Face TNF The North Face NF")
- Related product terms (e.g. "PlayStation" → "PlayStation PS5 PS4 consola gaming")
- Common misspellings people search for
- Both Spanish and English terms when applicable

Categories available: electronics, vehicles, apparel, furniture, home-goods, sporting-goods, musical-instruments, toys-games

Return the expanded text as a single string (NOT a list). Also infer the best category if not provided.
Keep it concise — max 50 words for expanded text.`,
      history: [
        {
          role: "user",
          content: `Query: "${query}"${requirements ? `\nRequirements: "${requirements}"` : ""}${category ? `\nCategory hint: "${category}"` : ""}`,
        },
      ],
      jsonSchema: EXPANSION_SCHEMA,
      temperature: 0.3,
    });
    return {
      expanded: result.expanded,
      inferredCategory: result.inferredCategory ?? null,
    };
  } catch (err) {
    log("Query expansion failed:", (err as Error).message);
    return { expanded: query, inferredCategory: null };
  }
}

// --- Scoring ---

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
          isExactMatch: {
            type: "boolean",
            description:
              "true ONLY if this listing is precisely what the buyer asked for (same brand, model, type). This is a label for UX only — it MUST NOT determine whether you include the product; include every product that scores >= the threshold regardless of this flag.",
          },
        },
        required: ["productId", "score", "rationale", "isExactMatch"],
      },
    },
  },
  required: ["matches"],
} as const;

/**
 * Find candidate products that could fulfill a buyer search (retrieval + embedding rank only).
 *
 * Pipeline:
 *   1. Query expansion — LLM generates synonyms and related terms
 *   2. Multi-embedding retrieval — embed original + expanded query, merge results
 *   3. Lexical retrieval — ILIKE search for exact term matches
 *
 * Does not run LLM re-rank or vision (see inline comment). Callers should pass rows through
 * {@link matchCandidatesFromRetrieval} with the buyer's `maxPrice` before negotiation/UI scoring.
 */
export async function findMatches(
  searchId: string,
  topN = 5,
): Promise<RetrievalMatch[]> {
  const search = await prisma.buyerSearch.findUnique({
    where: { id: searchId },
  });
  if (!search) throw new Error(`Search ${searchId} not found`);

  const ceiling = search.maxPrice * 1.3;
  const category = normalizeCategory(search.category);
  const imageDescription =
    (search as typeof search & { imageDescription?: string | null })
      .imageDescription ?? null;

  // Step 1: Query expansion
  const { expanded, inferredCategory } = await expandQuery(
    search.query,
    search.requirements,
    category,
  );
  const effectiveCategory = category ?? inferredCategory;
  log(
    `[matching] Query: "${search.query}" → Expanded: "${expanded}" | Category: ${effectiveCategory}`,
  );

  // Step 2: Multi-embedding retrieval (original + expanded in parallel)
  const originalSearchText = [
    search.query,
    search.requirements,
    effectiveCategory ? `Category: ${effectiveCategory}` : null,
    imageDescription ? `Visual: ${imageDescription}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const expandedSearchText = [
    expanded,
    search.requirements,
    imageDescription ? `Visual: ${imageDescription}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const [originalEmbed, expandedEmbed] = await Promise.all([
    embedText(originalSearchText),
    embedText(expandedSearchText),
  ]);

  const originalVector = toVectorLiteral(originalEmbed.values);
  const expandedVector = toVectorLiteral(expandedEmbed.values);

  // Step 3: Parallel retrieval — vector (original + expanded) + lexical
  const [
    originalVectorCandidates,
    expandedVectorCandidates,
    lexicalCandidates,
  ] = await Promise.all([
    findCandidatesWithCategoryFallback(effectiveCategory, (cat) =>
      findVectorCandidates(originalVector, ceiling, cat),
    ),
    findCandidatesWithCategoryFallback(effectiveCategory, (cat) =>
      findVectorCandidates(expandedVector, ceiling, cat),
    ),
    findCandidatesWithCategoryFallback(effectiveCategory, (cat) =>
      findLexicalCandidates(search.query, search.requirements, ceiling, cat),
    ),
  ]);

  let candidates = mergeCandidates(
    originalVectorCandidates,
    expandedVectorCandidates,
    lexicalCandidates,
  );

  if (candidates.length === 0) {
    const [fallbackOrig, fallbackExp] = await Promise.all([
      findNearestVectorCandidates(originalVector, ceiling),
      findNearestVectorCandidates(expandedVector, ceiling),
    ]);
    candidates = mergeCandidates(fallbackOrig, fallbackExp);
  }

  if (candidates.length === 0) return [];

  // I believe this are not needed with the new embeddings that takin into account the
  // descriptions of the images, so DO NOT remove unless you're absolutely certain it makes sense
  // to do so.
  /*
  const candidateMap = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  let matches = await scoreCandidatesWithLlm(
    {
      query: search.query,
      expandedQuery: expanded,
      requirements: search.requirements,
      category: effectiveCategory,
      maxPrice: search.maxPrice,
      negotiationStrategy: search.negotiationStrategy,
      imageDescription,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        description: candidate.description,
        category: candidate.category,
        askPrice: candidate.askPrice,
        vectorSimilarity: candidate.similarity,
      })),
    },
    candidateMap,
  );

  if (imageDescription) {
    matches = await visionRerank(matches, candidateMap, imageDescription);
  }
  return matches.slice(0, topN);
  */

  console.log(candidates);

  return candidates.slice(0, topN).map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    description: candidate.description,
    category: candidate.category,
    askPrice: candidate.askPrice,
    vectorSimilarity: candidate.similarity,
  }));
}

// --- Price-aware scoring ---

async function scoreCandidatesWithLlm(
  input: ScoringInput,
  candidateMap: Map<string, ProductCandidate>,
): Promise<MatchCandidate[]> {
  const fallbackMatches = candidatesToMatches(
    input.candidates
      .map((candidate) => candidateMap.get(candidate.id))
      .filter((candidate): candidate is ProductCandidate => Boolean(candidate)),
    input.maxPrice,
  );

  try {
    const result = await generateJSON<LlmScoringResponse>({
      system: `You are ranking product matches for an Argentine second-hand marketplace.

Score how well each product satisfies the buyer's intent, not just broad category similarity.
Use 0 for a different product type, 0.25 for weak/ambiguous matches, 0.5 for plausible but flawed matches, 0.75 for good matches, and 0.9+ only for excellent matches.
Reject false positives aggressively: for example, accessories, parts, unrelated brands, or products that only share a category should score below 0.5.
Consider requirements, category, visual description, budget, and the retrieval vectorSimilarity.

IMPORTANT for the matches array:
- Include EVERY retrieved candidate that scores >= ${minLlmMatchScore()}, up to the full candidate list. Do not shorten the list to a single "best" or "exact" listing when several listings qualify.
- Sort by score descending so the strongest matches appear first.
- Set isExactMatch true only for listings that precisely match what the buyer asked for; set it false for close or partial matches — but still include those listings if their score clears the threshold.`,
      history: [
        {
          role: "user",
          content: JSON.stringify(input),
        },
      ],
      jsonSchema: SCORING_SCHEMA,
      temperature: 0.1,
    });

    const seen = new Set<string>();
    const scored = result.matches
      .map((match) => {
        const candidate = candidateMap.get(match.productId);
        if (!candidate || seen.has(match.productId)) return null;
        seen.add(match.productId);
        const llmScore = clampScore(match.score);
        if (llmScore < minLlmMatchScore()) return null;
        const score = priceAdjustedScore(
          llmScore,
          candidate.askPrice,
          input.maxPrice,
        );
        if (score < minLlmMatchScore()) return null;
        const matchQuality: MatchQuality =
          match.isExactMatch === true ? "exact" : classifyMatchQuality(score);
        return {
          productId: match.productId,
          score,
          rationale: match.rationale,
          matchQuality,
        };
      })
      .filter((match): match is MatchCandidate => Boolean(match))
      .sort((a, b) => b.score - a.score);

    const llmIds = new Set(scored.map((m) => m.productId));
    const supplemental = fallbackMatches.filter(
      (m) => !llmIds.has(m.productId) && m.score >= minLlmMatchScore(),
    );
    const merged = [...scored, ...supplemental].sort(
      (a, b) => b.score - a.score,
    );

    if (merged.length === 0) {
      log("[matching] LLM rejected all candidates.");
    } else if (supplemental.length > 0) {
      log(
        `[matching] Added ${supplemental.length} retrieval fallback match(es) not returned by LLM re-rank.`,
      );
    }
    return merged;
  } catch (err) {
    log("[matching] LLM scoring failed:", (err as Error).message);
    return fallbackMatches.filter((match) => match.score >= minLlmMatchScore());
  }
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

function priceAdjustedScore(
  baseSimilarity: number,
  askPrice: number,
  maxPrice: number,
): number {
  if (maxPrice <= 0) return baseSimilarity;
  const ratio = askPrice / maxPrice;
  let priceBonus = 0;
  if (ratio <= 1.0) {
    priceBonus = 0.1 * (1 - Math.abs(ratio - 0.7));
  } else if (ratio <= 1.3) {
    priceBonus = (-0.05 * (ratio - 1.0)) / 0.3;
  } else {
    priceBonus = -0.15;
  }
  return Math.max(0, Math.min(1, baseSimilarity + priceBonus));
}

/** Turn retrieval rows into scored {@link MatchCandidate}s for the runner / job payload. */
export function matchCandidatesFromRetrieval(
  rows: RetrievalMatch[],
  maxPrice: number,
): MatchCandidate[] {
  return rows.map((row) => {
    const score = priceAdjustedScore(
      row.vectorSimilarity,
      row.askPrice,
      maxPrice,
    );
    return {
      productId: row.id,
      score,
      rationale: "Ranked by similarity to your search (embeddings).",
      matchQuality: classifyMatchQuality(score),
    };
  });
}

// --- Vision re-ranking (parallel with concurrency limit) ---

async function visionRerank(
  matches: MatchCandidate[],
  candidateMap: Map<string, ProductCandidate>,
  buyerDescription: string,
): Promise<MatchCandidate[]> {
  const withImages = matches.filter(
    (m) => candidateMap.get(m.productId)?.imageUrl,
  );
  const withoutImages = matches.filter(
    (m) => !candidateMap.get(m.productId)?.imageUrl,
  );

  const chunks: MatchCandidate[][] = [];
  for (let i = 0; i < withImages.length; i += VISION_CONCURRENCY) {
    chunks.push(withImages.slice(i, i + VISION_CONCURRENCY));
  }

  const visionResults: MatchCandidate[] = [];

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (match) => {
        const candidate = candidateMap.get(match.productId)!;
        const visionResult = await verifyProductMatch(
          candidate.imageUrl!,
          buyerDescription,
          candidate.title,
        );

        if (visionResult.matches) {
          const boostedScore = match.score * (0.6 + visionResult.confidence * 0.4);
          return {
            ...match,
            score: boostedScore,
            rationale: `${match.rationale} | Vision OK (${Math.round(visionResult.confidence * 100)}%): ${visionResult.reason}`,
            matchQuality: visionResult.confidence >= 0.85 && match.matchQuality === "exact"
              ? "exact" as MatchQuality
              : classifyMatchQuality(boostedScore),
          };
        }
        log(`[vision] Rejected "${candidate.title}": ${visionResult.reason}`);
        return {
          ...match,
          score: match.score * 0.15,
          rationale: `${match.rationale} | Vision REJECTED: ${visionResult.reason}`,
          matchQuality: "approximate" as MatchQuality,
        };
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        visionResults.push(result.value);
      } else {
        log("[vision] Error:", result.reason);
      }
    }
  }

  const processedIds = new Set(visionResults.map((r) => r.productId));
  const unprocessed = withImages.filter((m) => !processedIds.has(m.productId));

  return [...visionResults, ...unprocessed, ...withoutImages].sort(
    (a, b) => b.score - a.score,
  );
}

// --- SQL retrieval ---

async function findVectorCandidates(
  vector: string,
  ceiling: number,
  category: string | null,
): Promise<ProductCandidate[]> {
  const categoryFilter = category
    ? Prisma.sql`AND LOWER(p."category") = LOWER(${category})`
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
      Prisma.sql`CASE WHEN p."title" ILIKE ${pattern} ESCAPE '\\' THEN 2 WHEN p."description" ILIKE ${pattern} ESCAPE '\\' THEN 1 ELSE 0 END`,
  );
  const categoryFilter = category
    ? Prisma.sql`AND LOWER(p."category") = LOWER(${category})`
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
      1 - LEAST(0.95, 0.35 + ("termHits" / ${terms.length * 2}) * 0.55) AS "distance",
      LEAST(0.95, 0.35 + ("termHits" / ${terms.length * 2}) * 0.55) AS "similarity"
    FROM lexical_candidates
    ORDER BY "similarity" DESC, "askPrice" ASC
    LIMIT ${MAX_CANDIDATES}
  `);
}

// --- Helpers ---

async function findCandidatesWithCategoryFallback(
  category: string | null,
  findCandidates: (category: string | null) => Promise<ProductCandidate[]>,
): Promise<ProductCandidate[]> {
  const candidates = await findCandidates(category);
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

function candidatesToMatches(
  candidates: ProductCandidate[],
  maxPrice: number,
): MatchCandidate[] {
  return candidates.map((candidate) => {
    const score = priceAdjustedScore(
      candidate.similarity,
      candidate.askPrice,
      maxPrice,
    );
    return {
      productId: candidate.id,
      score,
      rationale: "Fallback retrieval score.",
      matchQuality: classifyMatchQuality(score),
    };
  });
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
  ).slice(0, 10);
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}
