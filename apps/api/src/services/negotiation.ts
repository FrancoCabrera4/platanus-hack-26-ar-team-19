import prisma from "@repo/db";
import { log } from "@repo/logger";
import { buyerMove, type BuyerNegotiatorContext } from "../agents/buyer-negotiator";
import { sellerMove, type SellerNegotiatorContext } from "../agents/seller-negotiator";
import type { NegotiatorMove } from "../agents/seller-negotiator";
import type { MatchQuality } from "./matching";

const MAX_TURNS = 4; // 2 buyer + 2 seller = fast negotiation

export interface NegotiationResult {
  negotiationId: string;
  status: "awaiting_buyer" | "accepted" | "rejected" | "timed_out" | "error";
  finalPrice: number | null;
  reason?: string;
  successful: boolean;
}

interface TranscriptEntry {
  side: "seller" | "buyer";
  price: number | null;
  message: string;
}

/**
 * Run a full negotiation between buyer and seller agents for a (search, product) pair.
 * Persists all messages to the DB. When the agents reach agreement, the negotiation is
 * left in `awaiting_buyer`; the buyer must explicitly confirm via POST /negotiations/:id/accept
 * to flip it to `accepted` and mark the product as sold.
 */
export async function runNegotiation(searchId: string, productId: string, matchQuality: MatchQuality = "exact"): Promise<NegotiationResult> {
  const [search, product] = await Promise.all([
    prisma.buyerSearch.findUnique({ where: { id: searchId } }),
    prisma.product.findUnique({ where: { id: productId } }),
  ]);
  if (!search) throw new Error(`Search ${searchId} not found`);
  if (!product) throw new Error(`Product ${productId} not found`);

  const existing = await prisma.negotiation.findFirst({
    where: { searchId, productId, status: "pending" },
  });
  const negotiation = existing
    ? await prisma.negotiation.update({
        where: { id: existing.id },
        data: { status: "running", startedAt: new Date() },
      })
    : await prisma.negotiation.create({
        data: {
          searchId,
          productId,
          buyerId: search.buyerId,
          sellerId: product.userId,
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
    successful: false,
  };

  try {
    // Re-fetch product fresh in case status changed mid-flight (e.g. sold to another buyer).
    const liveProduct = await prisma.product.findUnique({ where: { id: productId } });
    if (!liveProduct || liveProduct.status !== "active") {
      result = {
        negotiationId: negotiation.id,
        status: "rejected",
        finalPrice: null,
        successful: false,
        reason: "Product no longer available.",
      };
    } else {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const isBuyerTurn = turn % 2 === 0; // buyer opens
        const turnsRemaining = MAX_TURNS - turn - 1;

        if (isBuyerTurn) {
          const ctx: BuyerNegotiatorContext = {
            product: {
              title: liveProduct.title,
              description: liveProduct.description,
              category: liveProduct.category,
              condition: liveProduct.condition,
              askPrice: liveProduct.askPrice,
            },
            search: {
              query: search.query,
              requirements: search.requirements,
              maxPrice: search.maxPrice,
              negotiationStrategy: search.negotiationStrategy,
            },
            transcript,
            turnsRemaining,
            matchQuality,
          };
          const move = await buyerMove(ctx);
          await persistTurn("buyer", move);

          if (move.action === "reject") {
            result = {
              negotiationId: negotiation.id,
              status: "rejected",
              finalPrice: null,
              successful: false,
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
              successful: true,
              reason: move.message,
            };
            break;
          }
        } else {
          const ctx: SellerNegotiatorContext = {
            product: {
              title: liveProduct.title,
              description: liveProduct.description,
              category: liveProduct.category,
              condition: liveProduct.condition,
              askPrice: liveProduct.askPrice,
              negotiationStrategy: liveProduct.negotiationStrategy,
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
              successful: false,
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
              successful: true,
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
      successful: false,
      reason: (err as Error).message,
    };
  }

  // When the agents reach agreement, leave the negotiation in `awaiting_buyer`
  // with the agreed price. The product stays active and `successful` stays false
  // until the buyer confirms via POST /negotiations/:id/accept.
  if (result.status === "accepted" && result.finalPrice != null) {
    if (result.finalPrice > search.maxPrice) {
      // Defensive: agents shouldn't agree above the buyer ceiling, but if they do,
      // reject the deal instead of presenting it for confirmation.
      result = {
        negotiationId: negotiation.id,
        status: "rejected",
        finalPrice: null,
        successful: false,
        reason: "Final price above buyer ceiling (safety check).",
      };
    } else {
      result = { ...result, status: "awaiting_buyer", successful: false };
      await prisma.negotiation.update({
        where: { id: negotiation.id },
        data: {
          status: "awaiting_buyer",
          successful: false,
          finalPrice: result.finalPrice,
          reason: result.reason,
        },
      });
      return result;
    }
  }

  await prisma.negotiation.update({
    where: { id: negotiation.id },
    data: {
      status: result.status,
      successful: result.successful,
      finalPrice: result.finalPrice,
      reason: result.reason,
      completedAt: new Date(),
    },
  });

  return result;
}
