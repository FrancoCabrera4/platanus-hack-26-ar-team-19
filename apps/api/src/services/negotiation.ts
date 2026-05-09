import prisma from "@repo/db";
import { log } from "@repo/logger";
import { buyerMove, type BuyerNegotiatorContext } from "../agents/buyer-negotiator";
import { sellerMove, type SellerNegotiatorContext } from "../agents/seller-negotiator";
import type { NegotiatorMove } from "../agents/seller-negotiator";

const MAX_TURNS = 8; // 4 buyer turns + 4 seller turns

export interface NegotiationResult {
  negotiationId: string;
  status: "accepted" | "rejected" | "timed_out" | "error";
  finalPrice: number | null;
  reason?: string;
  dealId?: string;
}

interface TranscriptEntry {
  side: "seller" | "buyer";
  price: number | null;
  message: string;
}

/**
 * Run a full negotiation between buyer and seller agents for a (search, listing) pair.
 * Persists all messages to the DB. Creates a Deal on accept.
 */
export async function runNegotiation(searchId: string, listingId: string): Promise<NegotiationResult> {
  const [search, listing] = await Promise.all([
    prisma.buyerSearch.findUnique({ where: { id: searchId } }),
    prisma.listing.findUnique({ where: { id: listingId } }),
  ]);
  if (!search) throw new Error(`Search ${searchId} not found`);
  if (!listing) throw new Error(`Listing ${listingId} not found`);

  const negotiation = await prisma.negotiation.create({
    data: {
      searchId,
      listingId,
      status: "running",
      startedAt: new Date(),
    },
  });

  const transcript: TranscriptEntry[] = [];
  const persistTurn = async (side: "seller" | "buyer", move: NegotiatorMove) => {
    transcript.push({ side, price: move.price ?? null, message: move.message });
    await prisma.negotiationMessage.create({
      data: {
        negotiationId: negotiation.id,
        side,
        action: move.action,
        proposedPrice: move.price ?? null,
        content: move.message,
      },
    });
  };

  let result: NegotiationResult = {
    negotiationId: negotiation.id,
    status: "timed_out",
    finalPrice: null,
  };

  try {
    // Re-fetch listing fresh in case status changed mid-flight (e.g. sold to another buyer).
    const liveListing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!liveListing || liveListing.status !== "active") {
      result = {
        negotiationId: negotiation.id,
        status: "rejected",
        finalPrice: null,
        reason: "Listing no longer available.",
      };
    } else {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const isBuyerTurn = turn % 2 === 0; // buyer opens
        const turnsRemaining = MAX_TURNS - turn - 1;

        if (isBuyerTurn) {
          const ctx: BuyerNegotiatorContext = {
            listing: {
              title: liveListing.title,
              description: liveListing.description,
              category: liveListing.category,
              condition: liveListing.condition,
              askPrice: liveListing.askPrice,
            },
            search: {
              query: search.query,
              requirements: search.requirements,
              maxPrice: search.maxPrice,
              minPrice: search.minPrice,
            },
            transcript,
            turnsRemaining,
          };
          const move = await buyerMove(ctx);
          await persistTurn("buyer", move);

          if (move.action === "reject") {
            result = {
              negotiationId: negotiation.id,
              status: "rejected",
              finalPrice: null,
              reason: `Buyer walked away: ${move.message}`,
            };
            break;
          }
          if (move.action === "accept") {
            const lastSellerPrice = [...transcript].reverse().find((m) => m.side === "seller")?.price;
            if (lastSellerPrice == null) continue; // can't accept with no seller price yet
            result = {
              negotiationId: negotiation.id,
              status: "accepted",
              finalPrice: lastSellerPrice,
              reason: move.message,
            };
            break;
          }
        } else {
          const ctx: SellerNegotiatorContext = {
            listing: {
              title: liveListing.title,
              description: liveListing.description,
              category: liveListing.category,
              condition: liveListing.condition,
              askPrice: liveListing.askPrice,
              minPrice: liveListing.minPrice,
              strategyNotes: liveListing.strategyNotes,
            },
            transcript,
            turnsRemaining,
          };
          const move = await sellerMove(ctx);
          await persistTurn("seller", move);

          if (move.action === "reject") {
            result = {
              negotiationId: negotiation.id,
              status: "rejected",
              finalPrice: null,
              reason: `Seller walked away: ${move.message}`,
            };
            break;
          }
          if (move.action === "accept") {
            const lastBuyerPrice = [...transcript].reverse().find((m) => m.side === "buyer")?.price;
            if (lastBuyerPrice == null) continue;
            result = {
              negotiationId: negotiation.id,
              status: "accepted",
              finalPrice: lastBuyerPrice,
              reason: move.message,
            };
            break;
          }
        }
      }
    }
  } catch (err) {
    log("Negotiation error:", (err as Error).message);
    result = {
      negotiationId: negotiation.id,
      status: "error",
      finalPrice: null,
      reason: (err as Error).message,
    };
  }

  // Final safety check before booking the deal: make sure listing is still available
  // and price is within both reservations. Prevents one listing being sold twice.
  if (result.status === "accepted" && result.finalPrice != null) {
    const dealResult = await prisma.$transaction(async (tx) => {
      const fresh = await tx.listing.findUnique({ where: { id: listingId } });
      if (!fresh || fresh.status !== "active") {
        return { ok: false as const, reason: "Listing was sold or withdrawn during negotiation." };
      }
      if (result.finalPrice! < fresh.minPrice) {
        return { ok: false as const, reason: "Final price below seller floor (safety check)." };
      }
      if (result.finalPrice! > search.maxPrice) {
        return { ok: false as const, reason: "Final price above buyer ceiling (safety check)." };
      }
      const deal = await tx.deal.create({
        data: {
          negotiationId: negotiation.id,
          listingId,
          searchId,
          buyerId: search.buyerId,
          sellerId: fresh.sellerId,
          finalPrice: result.finalPrice!,
        },
      });
      await tx.listing.update({
        where: { id: listingId },
        data: { status: "sold" },
      });
      return { ok: true as const, dealId: deal.id };
    });

    if (dealResult.ok) {
      result.dealId = dealResult.dealId;
    } else {
      result = {
        negotiationId: negotiation.id,
        status: "rejected",
        finalPrice: null,
        reason: dealResult.reason,
      };
    }
  }

  await prisma.negotiation.update({
    where: { id: negotiation.id },
    data: {
      status: result.status,
      finalPrice: result.finalPrice,
      reason: result.reason,
      completedAt: new Date(),
    },
  });

  return result;
}
