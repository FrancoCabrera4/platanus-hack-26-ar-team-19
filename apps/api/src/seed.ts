/**
 * Seed a few sellers + listings + a buyer search so the negotiation flow
 * can be demoed without going through the LLM onboarding chats first.
 *
 * Run with: pnpm --filter api seed
 */
import "dotenv/config";
import prisma from "@repo/db";

async function main() {
  const sellers = await Promise.all([
    prisma.user.upsert({
      where: { email: "ana@demo.dev" },
      update: { emailVerifiedAt: new Date() },
      create: { name: "Ana", email: "ana@demo.dev", role: "seller", emailVerifiedAt: new Date() },
    }),
    prisma.user.upsert({
      where: { email: "bruno@demo.dev" },
      update: { emailVerifiedAt: new Date() },
      create: { name: "Bruno", email: "bruno@demo.dev", role: "seller", emailVerifiedAt: new Date() },
    }),
    prisma.user.upsert({
      where: { email: "clara@demo.dev" },
      update: { emailVerifiedAt: new Date() },
      create: { name: "Clara", email: "clara@demo.dev", role: "seller", emailVerifiedAt: new Date() },
    }),
  ]);

  const buyer = await prisma.user.upsert({
    where: { email: "diego@demo.dev" },
      update: { emailVerifiedAt: new Date() },
      create: { name: "Diego", email: "diego@demo.dev", role: "buyer", emailVerifiedAt: new Date() },
  });

  // Wipe old demo data. Delete in FK-safe order to avoid constraint errors.
  const sellerIds = sellers.map((s) => s.id);
  const oldListings = await prisma.listing.findMany({ where: { sellerId: { in: sellerIds } }, select: { id: true } });
  const oldListingIds = oldListings.map((l) => l.id);
  const oldSearches = await prisma.buyerSearch.findMany({ where: { buyerId: buyer.id }, select: { id: true } });
  const oldSearchIds = oldSearches.map((s) => s.id);

  if (oldListingIds.length > 0 || oldSearchIds.length > 0) {
    await prisma.deal.deleteMany({
      where: { OR: [{ listingId: { in: oldListingIds } }, { searchId: { in: oldSearchIds } }] },
    });
    await prisma.negotiationMessage.deleteMany({
      where: { negotiation: { OR: [{ listingId: { in: oldListingIds } }, { searchId: { in: oldSearchIds } }] } },
    });
    await prisma.negotiation.deleteMany({
      where: { OR: [{ listingId: { in: oldListingIds } }, { searchId: { in: oldSearchIds } }] },
    });
    await prisma.job.deleteMany({ where: { searchId: { in: oldSearchIds } } });
  }
  await prisma.listing.deleteMany({ where: { sellerId: { in: sellerIds } } });
  await prisma.buyerSearch.deleteMany({ where: { buyerId: buyer.id } });

  const [ana, bruno, clara] = sellers;

  await prisma.listing.createMany({
    data: [
      {
        sellerId: ana!.id,
        title: "iPhone 13 128GB",
        description: "Used for one year, screen in perfect condition, battery health 89%. Comes with original box and charger.",
        category: "electronics",
        condition: "good",
        askPrice: 600000,
        minPrice: 500000,
        maxPrice: 650000,
        strategyNotes: "Quick sale preferred — moving abroad next month.",
      },
      {
        sellerId: bruno!.id,
        title: "iPhone 13 Pro 256GB",
        description: "Almost new, used for 3 months. Includes case and screen protector.",
        category: "electronics",
        condition: "like-new",
        askPrice: 850000,
        minPrice: 750000,
      },
      {
        sellerId: clara!.id,
        title: "iPhone 12 64GB",
        description: "Older model, fully working, some scratches on the back.",
        category: "electronics",
        condition: "fair",
        askPrice: 400000,
        minPrice: 320000,
      },
    ],
  });

  const search = await prisma.buyerSearch.create({
    data: {
      buyerId: buyer.id,
      query: "iPhone 13",
      requirements: "Prefer 128GB or higher, good battery, original box ideally.",
      category: "electronics",
      minPrice: 400000,
      maxPrice: 580000,
      timeBudgetSeconds: 120,
      status: "ready",
    },
  });

  console.log("Seeded:");
  console.log("  buyer:", buyer.id);
  console.log("  search:", search.id);
  console.log("  sellers:", sellers.map((s) => s.id));
  console.log("\nNext: curl -X POST http://localhost:4000/searches/" + search.id + "/run");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
