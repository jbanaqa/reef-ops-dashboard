import { NextRequest, NextResponse } from "next/server";

import { getCollectionWithProducts } from "@/lib/collection-rotation";
import {
  normalizeWeights,
  STRATEGY_PRESETS,
  type RotationStrategy,
} from "@/lib/collection-rotation-scoring";
import { prisma } from "@/lib/prisma";
import { getShopifyShopDomain } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STRATEGIES = new Set<RotationStrategy>([
  "BALANCED",
  "PERFORMANCE",
  "DISCOVERY",
  "RANDOM",
  "CUSTOM",
]);

function collectionId(request: NextRequest, body?: Record<string, unknown>) {
  const value =
    body?.collectionId ?? request.nextUrl.searchParams.get("collectionId");
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest) {
  try {
    const id = collectionId(request);

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "collectionId is required." },
        { status: 400 }
      );
    }

    const shop = getShopifyShopDomain();
    const gid = id.startsWith("gid://")
      ? id
      : `gid://shopify/Collection/${id}`;
    const rotation = await prisma.collectionRotation.findUnique({
      where: {
        shop_shopifyCollectionId: { shop, shopifyCollectionId: gid },
      },
    });

    return NextResponse.json({
      ok: true,
      settings: {
        strategy: rotation?.strategy ?? "BALANCED",
        performanceWeight: rotation?.performanceWeight ?? 45,
        exposureWeight: rotation?.exposureWeight ?? 30,
        freshnessWeight: rotation?.freshnessWeight ?? 15,
        explorationWeight: rotation?.explorationWeight ?? 10,
        analyticsLookbackDays: rotation?.analyticsLookbackDays ?? 30,
      },
      presets: STRATEGY_PRESETS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Could not load strategy.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = collectionId(request, body);

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "collectionId is required." },
        { status: 400 }
      );
    }

    const strategy = String(body.strategy ?? "").toUpperCase() as RotationStrategy;

    if (!VALID_STRATEGIES.has(strategy)) {
      return NextResponse.json(
        { ok: false, error: "Select a valid rotation strategy." },
        { status: 400 }
      );
    }

    const requestedWeights = normalizeWeights({
      performance: Number(body.performanceWeight),
      exposure: Number(body.exposureWeight),
      freshness: Number(body.freshnessWeight),
      exploration: Number(body.explorationWeight),
    });
    const weights =
      strategy === "CUSTOM"
        ? requestedWeights
        : STRATEGY_PRESETS[
            strategy as Exclude<RotationStrategy, "CUSTOM">
          ];
    const analyticsLookbackDays = Math.min(
      90,
      Math.max(7, Math.round(Number(body.analyticsLookbackDays) || 30))
    );
    const collection = await getCollectionWithProducts(id);
    const shop = getShopifyShopDomain();
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
        strategy,
        performanceWeight: weights.performance,
        exposureWeight: weights.exposure,
        freshnessWeight: weights.freshness,
        explorationWeight: weights.exploration,
        analyticsLookbackDays,
      },
      update: {
        collectionTitle: collection.title,
        collectionHandle: collection.handle,
        strategy,
        performanceWeight: weights.performance,
        exposureWeight: weights.exposure,
        freshnessWeight: weights.freshness,
        explorationWeight: weights.exploration,
        analyticsLookbackDays,
      },
    });

    return NextResponse.json({ ok: true, settings: rotation });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Could not save strategy.",
      },
      { status: 400 }
    );
  }
}
