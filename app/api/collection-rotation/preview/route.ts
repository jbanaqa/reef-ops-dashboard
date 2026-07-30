import { NextRequest, NextResponse } from "next/server";

import { getCollectionWithProducts } from "@/lib/collection-rotation";
import { buildCollectionRotationPlan } from "@/lib/collection-rotation-plan";
import { prisma } from "@/lib/prisma";
import { getShopifyShopDomain } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All displayed score figures share this precision so a value that reads the
// same in one column (e.g. Performance) can't silently disagree with a more
// heavily-rounded neighbor (e.g. the old whole-number Performance column vs.
// the one-decimal Score column) and make two rows look tied when they aren't.
function roundForDisplay(value: number) {
  return Math.round(value * 10) / 10;
}

export async function GET(request: NextRequest) {
  try {
    const collectionId =
      request.nextUrl.searchParams.get("collectionId")?.trim() ?? "";

    if (!collectionId) {
      return NextResponse.json(
        { ok: false, error: "collectionId is required." },
        { status: 400 }
      );
    }

    const shop = getShopifyShopDomain();
    const collection = await getCollectionWithProducts(collectionId);
    const rotation = await prisma.collectionRotation.upsert({
      where: {
        shop_shopifyCollectionId: {
          shop,
          shopifyCollectionId: collection.id,
        },
      },
      create: {
        shop,
        shopifyCollectionId: collection.id,
        collectionTitle: collection.title,
        collectionHandle: collection.handle,
      },
      update: {
        collectionTitle: collection.title,
        collectionHandle: collection.handle,
      },
      include: {
        controlledProducts: {
          select: { shopifyProductId: true, position: true, zone: true },
        },
      },
    });
    const plan = await buildCollectionRotationPlan({
      shop,
      products: collection.products,
      rotation,
      seed: `${rotation.id}:preview:${Date.now()}`,
    });

    return NextResponse.json({
      ok: true,
      collection: {
        id: collection.id,
        title: collection.title,
        productCount: collection.products.length,
      },
      preview: {
        ...plan,
        scores: plan.scores.map((score) => ({
          ...score,
          score: roundForDisplay(score.score),
          performance: roundForDisplay(score.performance),
          exposure: roundForDisplay(score.exposure),
          freshness: roundForDisplay(score.freshness),
          exploration: roundForDisplay(score.exploration),
          breakdown: {
            ...score.breakdown,
            performance: {
              ...score.breakdown.performance,
              unitsRank: roundForDisplay(score.breakdown.performance.unitsRank),
              revenueRank: roundForDisplay(
                score.breakdown.performance.revenueRank
              ),
            },
            exposure: {
              ...score.breakdown.exposure,
              averageOpportunityPercent: roundForDisplay(
                score.breakdown.exposure.averageOpportunityPercent
              ),
            },
          },
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Could not build preview.",
      },
      { status: 500 }
    );
  }
}
