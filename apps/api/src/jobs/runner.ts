import prisma from "@repo/db";
import { log } from "@repo/logger";
import {
  findMatches,
  matchCandidatesFromRetrieval,
  type MatchQuality,
} from "../services/matching";
import { runNegotiation } from "../services/negotiation";
import { tryAutoPay } from "../services/auto-pay";

export interface RunSearchJobPayload {
  searchId: string;
  topN?: number;
}

export interface RunSearchJobResult {
  matches: { productId: string; score: number; rationale: string; matchQuality: MatchQuality }[];
  negotiations: {
    productId: string;
    negotiationId: string;
    status: string;
    successful: boolean;
    finalPrice: number | null;
    matchQuality: MatchQuality;
  }[];
  successfulNegotiation: {
    negotiationId: string;
    productId: string;
    finalPrice: number;
    matchQuality: MatchQuality;
  } | null;
  bestMatchQuality: MatchQuality | "no_match";
}

/**
 * Enqueue a "run_search" job. Returns immediately with the Job id;
 * the work runs on the Node event loop and updates the row when done.
 */
export async function enqueueRunSearch(payload: RunSearchJobPayload): Promise<string> {
  const job = await prisma.job.create({
    data: {
      type: "run_search",
      status: "queued",
      searchId: payload.searchId,
      payload: JSON.stringify(payload),
    },
  });

  setImmediate(() => {
    void runJob(job.id).catch((err) => log("runJob fatal:", (err as Error).message));
  });

  return job.id;
}

async function runJob(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "running" },
  });

  try {
    if (job.type === "run_search") {
      const payload = JSON.parse(job.payload) as RunSearchJobPayload;
      const result = await executeRunSearch(payload);
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "succeeded", result: JSON.stringify(result) },
      });
    } else {
      throw new Error(`Unknown job type: ${job.type}`);
    }
  } catch (err) {
    log(`Job ${jobId} failed:`, (err as Error).message);
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "failed", error: (err as Error).message },
    });
    if (job.searchId) {
      await prisma.buyerSearch.update({
        where: { id: job.searchId },
        data: { status: "failed" },
      });
    }
  }
}

async function executeRunSearch(payload: RunSearchJobPayload): Promise<RunSearchJobResult> {
  await prisma.buyerSearch.update({
    where: { id: payload.searchId },
    data: { status: "running" },
  });

  const search = await prisma.buyerSearch.findUnique({ where: { id: payload.searchId } });
  if (!search) throw new Error(`Search ${payload.searchId} not found`);

  const retrieval = await findMatches(payload.searchId, payload.topN ?? 5);
  const matches = matchCandidatesFromRetrieval(retrieval, search.maxPrice);
  log(
    `[runner] Found ${matches.length} matches for search ${payload.searchId}: ${matches.map((m) => `${m.productId.slice(0, 8)}(${m.score.toFixed(2)})`).join(", ")}`,
  );

  const sortedMatches = [...matches].sort((a, b) => b.score - a.score);
  const bestMatchQuality: MatchQuality | "no_match" = sortedMatches.length > 0
    ? sortedMatches[0]!.matchQuality
    : "no_match";

  const negotiations: RunSearchJobResult["negotiations"] = [];
  let successfulNegotiation: RunSearchJobResult["successfulNegotiation"] = null;

  for (const m of sortedMatches) {
    const product = await prisma.product.findUnique({ where: { id: m.productId } });
    if (!product) continue;

    log(`[runner] Negotiating ${m.productId.slice(0, 8)} (score: ${m.score.toFixed(2)}, quality: ${m.matchQuality})`);
    const result = await runNegotiation(payload.searchId, m.productId, m.matchQuality);
    negotiations.push({
      productId: m.productId,
      negotiationId: result.negotiationId,
      status: result.status,
      successful: result.successful,
      finalPrice: result.finalPrice,
      matchQuality: m.matchQuality,
    });

    if (result.status === "awaiting_buyer" && result.finalPrice !== null) {
      if (!successfulNegotiation) {
        successfulNegotiation = {
          negotiationId: result.negotiationId,
          productId: m.productId,
          finalPrice: result.finalPrice,
          matchQuality: m.matchQuality,
        };
      }
      log(`[runner] Deal closed! ${m.productId.slice(0, 8)} at $${result.finalPrice} (${m.matchQuality})`);

      const autoPaid = await tryAutoPay(
        result.negotiationId,
        search.buyerId,
        result.finalPrice,
        product.category ?? null,
      );
      if (autoPaid) {
        log(`[runner] Auto-pay succeeded for ${result.negotiationId}`);
      }
    }
  }

  await prisma.buyerSearch.update({
    where: { id: payload.searchId },
    data: { status: "completed" },
  });

  return { matches, negotiations, successfulNegotiation, bestMatchQuality };
}
