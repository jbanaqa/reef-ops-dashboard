import { NextRequest, NextResponse } from "next/server";

import { getCollectionWithProducts } from "@/lib/collection-rotation";
import { buildCollectionRotationPlan } from "@/lib/collection-rotation-plan";
import { prisma } from "@/lib/prisma";
import { getShopifyShopDomain } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
          select: { shopifyProductId: true, position: true },
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
          score: Math.round(score.score * 10) / 10,
          performance: Math.round(score.performance),
          exposure: Math.round(score.exposure),
          freshness: Math.round(score.freshness),
          exploration: Math.round(score.exploration),
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
