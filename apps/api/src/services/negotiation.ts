import prisma from "@repo/db";
import { log } from "@repo/logger";
import { buyerMove, type BuyerNegotiatorContext } from "../agents/buyer-negotiator";
import { sellerMove, type SellerNegotiatorContext } from "../agents/seller-negotiator";
import type { NegotiatorMove } from "../agents/seller-negotiator";

const MAX_TURNS = 8; // 4 buyer turns + 4 seller turns

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
 * Persists all messages to the DB. An accepted Negotiation is the deal record.
 */
export async function runNegotiation(searchId: string, productId: string): Promise<NegotiationResult> {
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
              status: "awaiting_buyer",
              finalPrice: lastSellerPrice,
              successful: false,
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
              status: "awaiting_buyer",
              finalPrice: lastBuyerPrice,
              successful: false,
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

  // If the agents reached an agreement, run the safety checks but stop short of
  // marking the product as sold — the human buyer still has to confirm the deal.
  if (result.status === "awaiting_buyer" && result.finalPrice != null) {
    const fresh = await prisma.product.findUnique({ where: { id: productId } });
    if (!fresh || fresh.status !== "active") {
      result = {
        negotiationId: negotiation.id,
        status: "rejected",
        finalPrice: null,
        successful: false,
        reason: "Product was sold or withdrawn during negotiation.",
      };
    } else if (result.finalPrice > search.maxPrice) {
      result = {
        negotiationId: negotiation.id,
        status: "rejected",
        finalPrice: null,
        successful: false,
        reason: "Final price above buyer ceiling (safety check).",
      };
    }
  }

  await prisma.negotiation.update({
    where: { id: negotiation.id },
    data: {
      status: result.status,
      successful: result.successful,
      finalPrice: result.finalPrice,
      reason: result.reason,
      completedAt: result.status === "awaiting_buyer" ? null : new Date(),
    },
  });

  return result;
}
