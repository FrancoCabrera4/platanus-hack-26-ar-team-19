import prisma from "@repo/db";
import { log } from "@repo/logger";
import { findMatches } from "../services/matching";
import { runNegotiation } from "../services/negotiation";

export interface RunSearchJobPayload {
  searchId: string;
  topN?: number;
}

export interface RunSearchJobResult {
  matches: { listingId: string; score: number; rationale: string }[];
  negotiations: {
    listingId: string;
    negotiationId: string;
    status: string;
    finalPrice: number | null;
    dealId?: string;
  }[];
  bestDeal: {
    dealId: string;
    listingId: string;
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

  const matches = await findMatches(payload.searchId, payload.topN ?? 3);

  const negotiations: RunSearchJobResult["negotiations"] = [];
  let bestDeal: { dealId: string; listingId: string; finalPrice: number } | null = null;

  // Run negotiations sequentially. We could parallelize, but sequential lets us
  // stop early if a great deal lands and avoids selling the same listing twice
  // (the listing.status check inside runNegotiation handles that anyway).
  for (const m of matches) {
    const result = await runNegotiation(payload.searchId, m.listingId);
    negotiations.push({
      listingId: m.listingId,
      negotiationId: result.negotiationId,
      status: result.status,
      finalPrice: result.finalPrice,
      dealId: result.dealId,
    });
    if (result.status === "accepted" && result.dealId && result.finalPrice != null) {
      bestDeal = {
        dealId: result.dealId,
        listingId: m.listingId,
        finalPrice: result.finalPrice,
      };
      // Stop after first deal — buyer wants ONE item, not several.
      break;
    }
  }

  await prisma.buyerSearch.update({
    where: { id: payload.searchId },
    data: { status: "completed" },
  });

  return { matches, negotiations, bestDeal };
}
