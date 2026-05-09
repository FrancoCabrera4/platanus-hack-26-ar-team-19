import prisma from "@repo/db";
import { generateJSON } from "../llm/gemini";
import { log } from "@repo/logger";

export interface MatchCandidate {
  listingId: string;
  score: number; // 0..1
  rationale: string;
}

interface ScoringInput {
  query: string;
  requirements?: string | null;
  category?: string | null;
  candidates: { id: string; title: string; description: string; category?: string | null; askPrice: number }[];
}

const SCORING_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          listingId: { type: "string" },
          score: { type: "number" },
          rationale: { type: "string" },
        },
        required: ["listingId", "score", "rationale"],
      },
    },
  },
  required: ["matches"],
} as const;

/**
 * Find candidate listings that could fulfill a buyer search.
 * Step 1: SQL filter by price overlap (askPrice <= buyer maxPrice + slack) and status=active.
 * Step 2: ask Gemini to score semantic relevance and return top N.
 */
export async function findMatches(searchId: string, topN = 3): Promise<MatchCandidate[]> {
  const search = await prisma.buyerSearch.findUnique({ where: { id: searchId } });
  if (!search) throw new Error(`Search ${searchId} not found`);

  // 20% slack on max price — sellers may negotiate down.
  const ceiling = search.maxPrice * 1.2;
  const candidates = await prisma.listing.findMany({
    where: {
      status: "active",
      askPrice: { lte: ceiling },
      ...(search.category ? { category: search.category } : {}),
    },
    take: 25,
  });

  if (candidates.length === 0) return [];
  if (candidates.length === 1) {
    return [{ listingId: candidates[0]!.id, score: 0.6, rationale: "Only candidate available." }];
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
        "You are a matching engine for a marketplace. Score how well each listing fits the buyer's request, " +
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
        listingId: c.id,
        score: 1 - Math.abs(c.askPrice - search.maxPrice) / Math.max(search.maxPrice, 1),
        rationale: "Fallback price-distance score.",
      })),
    };
  }

  // Defensive: keep only candidates we actually queried.
  const validIds = new Set(candidates.map((c) => c.id));
  return scored.matches
    .filter((m) => validIds.has(m.listingId))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
