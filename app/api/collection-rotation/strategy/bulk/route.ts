import { NextRequest, NextResponse } from "next/server";

import {
  STRATEGY_PRESETS,
  type RotationStrategy,
} from "@/lib/collection-rotation-scoring";
import { prisma } from "@/lib/prisma";
import { getShopifyShopDomain } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bulk assignment intentionally only supports the ready-made presets, not
// CUSTOM - custom weights are a per-collection tuning exercise (the numbers
// have to add to 100 and are meant to be reasoned about one collection at a
// time), so they stay in the single-collection Strategy panel.
const VALID_BULK_STRATEGIES = new Set<RotationStrategy>([
  "BALANCED",
  "PERFORMANCE",
  "DISCOVERY",
  "RANDOM",
]);

type BulkCollectionInput = {
  collectionId?: unknown;
  collectionTitle?: unknown;
  collectionHandle?: unknown;
};

type NormalizedCollectionInput = {
  id: string;
  title: string;
  handle: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const strategy = String(
      body.strategy ?? ""
    ).toUpperCase() as RotationStrategy;

    if (!VALID_BULK_STRATEGIES.has(strategy)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Select Balanced, Performance, Discovery, or Random to apply to multiple collections at once.",
        },
        { status: 400 }
      );
    }

    const rawCollections = Array.isArray(body.collections)
      ? body.collections
      : [];

    const collectionsInput: NormalizedCollectionInput[] = rawCollections
      .map((entry) => {
        const item = entry as BulkCollectionInput;

        const id =
          typeof item.collectionId === "string"
            ? item.collectionId.trim()
            : "";

        const title =
          typeof item.collectionTitle === "string"
            ? item.collectionTitle.trim()
            : "";

        const handle =
          typeof item.collectionHandle === "string"
            ? item.collectionHandle.trim()
            : "";

        return { id, title, handle };
      })
      .filter((item) => item.id && item.title);

    if (collectionsInput.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Select at least one collection to update.",
        },
        { status: 400 }
      );
    }

    const weights =
      STRATEGY_PRESETS[
        strategy as Exclude<RotationStrategy, "CUSTOM">
      ];

    const shop = getShopifyShopDomain();

    const results = await Promise.all(
      collectionsInput.map(async ({ id, title, handle }) => {
        try {
          const rotation = await prisma.collectionRotation.upsert({
            where: {
              shop_shopifyCollectionId: {
                shop,
                shopifyCollectionId: id,
              },
            },

            create: {
              shop,
              shopifyCollectionId: id,
              collectionTitle: title,
              collectionHandle: handle || null,
              strategy,
              performanceWeight: weights.performance,
              exposureWeight: weights.exposure,
              freshnessWeight: weights.freshness,
              explorationWeight: weights.exploration,
            },

            update: {
              collectionTitle: title,
              collectionHandle: handle || null,
              strategy,
              performanceWeight: weights.performance,
              exposureWeight: weights.exposure,
              freshnessWeight: weights.freshness,
              explorationWeight: weights.exploration,
            },

            select: {
              shopifyCollectionId: true,
            },
          });

          return {
            collectionId: rotation.shopifyCollectionId,
            ok: true as const,
          };
        } catch (error) {
          return {
            collectionId: id,
            ok: false as const,
            error:
              error instanceof Error
                ? error.message
                : "Failed to save strategy for this collection.",
          };
        }
      })
    );

    const failed = results
      .filter((result) => !result.ok)
      .map((result) => ({
        collectionId: result.collectionId,
        error: (result as { error?: string }).error,
      }));

    return NextResponse.json({
      ok: true,
      strategy,
      updatedCount: results.length - failed.length,
      failed,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not save strategy for the selected collections.",
      },
      { status: 400 }
    );
  }
}
