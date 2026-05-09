import { Prisma } from "@prisma/client";
import prisma from "@repo/db";
import { log } from "@repo/logger";
import { generateJSON } from "../llm/gemini";
import { embedText, toVectorLiteral } from "./embeddings";
import { verifyProductMatch } from "./vision";
import { checkCandidates, getCategoryAverages, verifyPriceWithMarket } from "./fraud";

export interface MatchCandidate {
  productId: string;
  score: number; // 0..1
  rationale: string;
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
const MAX_CANDIDATES = 30;
const FALLBACK_VECTOR_CANDIDATES = 15;
const VISION_CONCURRENCY = 5;
const STOP_WORDS = new Set([
  "con", "del", "el", "la", "las", "los", "para", "por",
  "que", "una", "uno", "busco", "quiero", "necesito",
]);

function minVectorSimilarity(): number {
  const configured = Number.parseFloat(process.env.MIN_MATCH_SIMILARITY ?? "");
  if (!Number.isFinite(configured)) return DEFAULT_MIN_VECTOR_SIMILARITY;
  return Math.min(Math.max(configured, 0), 1);
}

// --- Query expansion ---

const EXPANSION_SCHEMA = {
  type: "object",
  properties: {
    expanded: { type: "string", description: "Expanded search text with synonyms and related terms" },
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
    const result = await generateJSON<{ expanded: string; inferredCategory?: string }>({
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
        },
        required: ["productId", "score", "rationale"],
      },
    },
  },
  required: ["matches"],
} as const;

/**
 * Find candidate products that could fulfill a buyer search.
 *
 * Pipeline:
 *   1. Query expansion — LLM generates synonyms and related terms
 *   2. Multi-embedding retrieval — embed original + expanded query, merge results
 *   3. Lexical retrieval — ILIKE search for exact term matches
 *   4. LLM re-rank — score candidates considering relevance, price, buyer intent
 *   5. Vision re-rank — parallel image verification against buyer's description
 */
export async function findMatches(
  searchId: string,
  topN = 5,
): Promise<MatchCandidate[]> {
  const search = await prisma.buyerSearch.findUnique({
    where: { id: searchId },
  });
  if (!search) throw new Error(`Search ${searchId} not found`);

  const ceiling = search.maxPrice * 1.3;
  const category = normalizeCategory(search.category);

  // Step 1: Query expansion
  const { expanded, inferredCategory } = await expandQuery(
    search.query,
    search.requirements,
    category,
  );
  const effectiveCategory = category ?? inferredCategory;
  log(`[matching] Query: "${search.query}" → Expanded: "${expanded}" | Category: ${effectiveCategory}`);

  // Step 2: Multi-embedding retrieval (original + expanded in parallel)
  const originalSearchText = [
    search.query,
    search.requirements,
    effectiveCategory ? `Category: ${effectiveCategory}` : null,
    search.imageDescription ? `Visual: ${search.imageDescription}` : null,
  ].filter(Boolean).join("\n");

  const expandedSearchText = [
    expanded,
    search.requirements,
    search.imageDescription ? `Visual: ${search.imageDescription}` : null,
  ].filter(Boolean).join("\n");

  const [originalEmbed, expandedEmbed] = await Promise.all([
    embedText(originalSearchText),
    embedText(expandedSearchText),
  ]);

  const originalVector = toVectorLiteral(originalEmbed.values);
  const expandedVector = toVectorLiteral(expandedEmbed.values);

  // Step 3: Parallel retrieval — vector (original + expanded) + lexical
  const [originalVectorCandidates, expandedVectorCandidates, lexicalCandidates] = await Promise.all([
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

  // Fraud filter — remove suspicious products before scoring
  const categoryAverages = await getCategoryAverages();
  const { passed, blocked } = checkCandidates(candidates, categoryAverages);
  if (blocked.length > 0) {
    log(`[matching] Fraud filter blocked ${blocked.length} candidates`);
  }
  candidates = passed;

  log(`[matching] ${candidates.length} candidates after retrieval + fraud filter`);

  if (candidates.length === 0) return [];
  if (candidates.length === 1) {
    return candidates.map((c) => ({
      productId: c.id,
      score: c.similarity,
      rationale: "Único candidato por encima del umbral de similitud.",
    }));
  }

  // Step 4: LLM re-rank with full buyer context
  const scoringInput: ScoringInput = {
    query: search.query,
    expandedQuery: expanded,
    requirements: search.requirements,
    category: effectiveCategory,
    maxPrice: search.maxPrice,
    negotiationStrategy: search.negotiationStrategy,
    imageDescription: search.imageDescription,
    candidates: candidates.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      category: c.category,
      askPrice: c.askPrice,
      vectorSimilarity: Math.round(c.similarity * 1000) / 1000,
    })),
  };

  let scored: { matches: MatchCandidate[] };
  try {
    scored = await generateJSON<{ matches: MatchCandidate[] }>({
      system: `You are an expert product matching engine for an Argentine marketplace (prices in ARS).

Score how well each candidate product matches the buyer's search. Consider ALL of these factors:

1. **Semantic relevance** (most important): Is this genuinely what the buyer wants? A "campera North Face" search should NOT match random jackets from other brands.
2. **Brand matching**: If buyer specified a brand, matching brand gets a big boost. Wrong brand = low score.
3. **Price reasonableness**: Products near the buyer's maxPrice are ideal. Products much cheaper might be suspicious (bad condition?). Products slightly above budget can still score if they're a great match.
4. **Category fit**: Does the product belong in the right category?
5. **Condition/requirements**: Does it meet the buyer's stated requirements?
6. **Vector similarity hint**: Use the vectorSimilarity as a starting point but override it with your judgment.

Scoring guide:
- 0.9-1.0: Perfect match — exactly what buyer wants, right brand, right price range
- 0.7-0.89: Strong match — same product type, minor differences
- 0.5-0.69: Decent match — related product, could work
- 0.3-0.49: Weak match — tangentially related
- 0.0-0.29: Poor match — wrong product entirely

Be STRICT. Most products should score below 0.5. Only genuine matches deserve high scores.
Return ALL candidates scored, sorted by score descending.`,
      history: [
        {
          role: "user",
          content: `Buyer search:\n${JSON.stringify(scoringInput, null, 2)}\n\nScore each candidate.`,
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
        score: priceAdjustedScore(c.similarity, c.askPrice, search.maxPrice),
        rationale: "Fallback: vector similarity + price adjustment.",
      })),
    };
  }

  const validIds = new Set(candidates.map((c) => c.id));
  let textRanked = scored.matches
    .filter((m) => validIds.has(m.productId))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(topN * 2, 8));

  if (textRanked.length === 0) {
    log("Match scoring returned no usable candidates; falling back to retrieval scores.");
    return candidatesToMatches(candidates, search.maxPrice).slice(0, topN);
  }

  // Step 5: Vision re-rank — parallel image verification
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const buyerDescription = [
    search.query,
    search.requirements,
    search.imageDescription,
  ].filter(Boolean).join(". ");

  textRanked = await visionRerank(textRanked, candidateMap, buyerDescription);

  const MIN_QUALITY_SCORE = 0.8;
  const qualityFiltered = textRanked.filter((m) => m.score >= MIN_QUALITY_SCORE);

  // Step 6: Market price verification — flag suspiciously cheap products
  const verified: MatchCandidate[] = [];
  for (const match of qualityFiltered.slice(0, topN)) {
    const candidate = candidateMap.get(match.productId);
    if (!candidate) { verified.push(match); continue; }

    const marketCheck = await verifyPriceWithMarket(candidate.title, candidate.askPrice);
    if (marketCheck?.suspicious) {
      log(`[matching] Market price fraud: "${candidate.title}" — ${marketCheck.reason}`);
      continue;
    }
    verified.push(match);
  }

  log(`[matching] Final: ${textRanked.length} scored, ${qualityFiltered.length} quality, ${verified.length} verified`);

  return verified;
}

// --- Price-aware scoring ---

function priceAdjustedScore(baseSimilarity: number, askPrice: number, maxPrice: number): number {
  if (maxPrice <= 0) return baseSimilarity;
  const ratio = askPrice / maxPrice;
  let priceBonus = 0;
  if (ratio <= 1.0) {
    priceBonus = 0.1 * (1 - Math.abs(ratio - 0.7));
  } else if (ratio <= 1.3) {
    priceBonus = -0.05 * (ratio - 1.0) / 0.3;
  } else {
    priceBonus = -0.15;
  }
  return Math.max(0, Math.min(1, baseSimilarity + priceBonus));
}

// --- Vision re-ranking (parallel with concurrency limit) ---

async function visionRerank(
  matches: MatchCandidate[],
  candidateMap: Map<string, ProductCandidate>,
  buyerDescription: string,
): Promise<MatchCandidate[]> {
  const withImages = matches.filter((m) => candidateMap.get(m.productId)?.imageUrl);
  const withoutImages = matches.filter((m) => !candidateMap.get(m.productId)?.imageUrl);

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
          return {
            ...match,
            score: match.score * (0.6 + visionResult.confidence * 0.4),
            rationale: `${match.rationale} | Vision OK (${Math.round(visionResult.confidence * 100)}%): ${visionResult.reason}`,
          };
        }
        log(`[vision] Rejected "${candidate.title}": ${visionResult.reason}`);
        return {
          ...match,
          score: match.score * 0.15,
          rationale: `${match.rationale} | Vision REJECTED: ${visionResult.reason}`,
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

  return [...visionResults, ...unprocessed, ...withoutImages]
    .sort((a, b) => b.score - a.score);
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

function candidatesToMatches(candidates: ProductCandidate[], maxPrice: number): MatchCandidate[] {
  return candidates.map((candidate) => ({
    productId: candidate.id,
    score: priceAdjustedScore(candidate.similarity, candidate.askPrice, maxPrice),
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
  ).slice(0, 10);
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}
