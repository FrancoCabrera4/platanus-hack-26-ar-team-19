import prisma from "@repo/db";
import { log } from "@repo/logger";
import { findMatches } from "../services/matching";
import { runNegotiation } from "../services/negotiation";

export interface RunSearchJobPayload {
  searchId: string;
  topN?: number;
}

export interface RunSearchJobResult {
  matches: { productId: string; score: number; rationale: string }[];
  negotiations: {
    productId: string;
    negotiationId: string;
    status: string;
    successful: boolean;
    finalPrice: number | null;
  }[];
  successfulNegotiation: {
    negotiationId: string;
    productId: string;
    finalPrice: number;
  } | null;
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

  const matches = await findMatches(payload.searchId, payload.topN ?? 5);
  log(`[runner] Found ${matches.length} matches for search ${payload.searchId}: ${matches.map((m) => `${m.productId.slice(0, 8)}(${m.score.toFixed(2)})`).join(", ")}`);

  const search = await prisma.buyerSearch.findUnique({ where: { id: payload.searchId } });
  if (!search) throw new Error(`Search ${payload.searchId} not found`);

  // Phase 1: Create all negotiations as "pending" sorted by score (best first)
  // so the frontend shows matched products immediately.
  const sortedMatches = [...matches].sort((a, b) => b.score - a.score);
  const pendingNegs: { productId: string; negotiationId: string; score: number }[] = [];
  for (const m of sortedMatches) {
    const product = await prisma.product.findUnique({ where: { id: m.productId } });
    if (!product) continue;

    const neg = await prisma.negotiation.create({
      data: {
        searchId: payload.searchId,
        productId: m.productId,
        buyerId: search.buyerId,
        sellerId: product.userId,
        status: "pending",
      },
    });
    pendingNegs.push({ productId: m.productId, negotiationId: neg.id, score: m.score });
  }

  // Phase 2: Negotiate best matches first. Stop after first successful deal.
  const negotiations: RunSearchJobResult["negotiations"] = [];
  let successfulNegotiation: RunSearchJobResult["successfulNegotiation"] = null;

  for (const pn of pendingNegs) {
    if (successfulNegotiation) {
      log(`[runner] Skipping negotiation for ${pn.productId.slice(0, 8)} — already have a deal`);
      negotiations.push({
        productId: pn.productId,
        negotiationId: pn.negotiationId,
        status: "pending",
        successful: false,
        finalPrice: null,
      });
      continue;
    }

    log(`[runner] Negotiating ${pn.productId.slice(0, 8)} (score: ${pn.score.toFixed(2)})`);
    const result = await runNegotiation(payload.searchId, pn.productId);
    negotiations.push({
      productId: pn.productId,
      negotiationId: result.negotiationId,
      status: result.status,
      successful: result.successful,
      finalPrice: result.finalPrice,
    });
    if (result.status === "accepted" && result.finalPrice !== null) {
      successfulNegotiation = {
        negotiationId: result.negotiationId,
        productId: pn.productId,
        finalPrice: result.finalPrice,
      };
      log(`[runner] Deal closed! ${pn.productId.slice(0, 8)} at $${result.finalPrice}`);
    }
  }

  await prisma.buyerSearch.update({
    where: { id: payload.searchId },
    data: { status: "completed" },
  });

  return { matches, negotiations, successfulNegotiation };
}
