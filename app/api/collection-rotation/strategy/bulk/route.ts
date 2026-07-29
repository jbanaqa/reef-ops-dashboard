import { NextRequest, NextResponse } from "next/server";

import {
  normalizeWeights,
  STRATEGY_PRESETS,
  type RotationStrategy,
} from "@/lib/collection-rotation-scoring";
import { prisma } from "@/lib/prisma";
import { getShopifyShopDomain } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All five strategies are now bulk-assignable. CUSTOM has two forms here:
//   - weightPresetId: apply a previously-saved named weight orientation
//     (see /api/collection-rotation/weight-presets) to every selected
//     collection.
//   - inline performance/exposure/freshness/explorationWeight fields: a
//     one-off custom split, typed in just for this bulk apply, not saved
//     anywhere as a reusable preset.
const VALID_BULK_STRATEGIES = new Set<RotationStrategy>([
  "BALANCED",
  "PERFORMANCE",
  "DISCOVERY",
  "RANDOM",
  "CUSTOM",
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
            "Select Balanced, Performance, Discovery, Random, or a custom orientation to apply to multiple collections at once.",
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

    const shop = getShopifyShopDomain();

    let weights: {
      performance: number;
      exposure: number;
      freshness: number;
      exploration: number;
    };

    if (strategy === "CUSTOM") {
      const weightPresetId =
        typeof body.weightPresetId === "string"
          ? body.weightPresetId.trim()
          : "";

      if (weightPresetId) {
        // Scoped to this shop, same as the individual preset endpoints - a
        // preset ID from another shop simply won't be found here.
        const preset = await prisma.rotationWeightPreset.findFirst({
          where: { id: weightPresetId, shop },
        });

        if (!preset) {
          return NextResponse.json(
            {
              ok: false,
              error: "That saved orientation no longer exists.",
            },
            { status: 400 }
          );
        }

        weights = normalizeWeights({
          performance: preset.performanceWeight,
          exposure: preset.exposureWeight,
          freshness: preset.freshnessWeight,
          exploration: preset.explorationWeight,
        });
      } else {
        // A one-off custom split typed in just for this bulk apply - not
        // saved as a reusable preset unless the person separately does that
        // from the Strategy panel.
        weights = normalizeWeights({
          performance: Number(body.performanceWeight),
          exposure: Number(body.exposureWeight),
          freshness: Number(body.freshnessWeight),
          exploration: Number(body.explorationWeight),
        });
      }
    } else {
      weights =
        STRATEGY_PRESETS[strategy as Exclude<RotationStrategy, "CUSTOM">];
    }

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
