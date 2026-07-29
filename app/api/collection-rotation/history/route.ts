import { NextRequest, NextResponse } from "next/server";

import { getCollectionWithProducts } from "@/lib/collection-rotation";
import { prisma } from "@/lib/prisma";
import { getShopifyShopDomain } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kept short on purpose: this is meant to answer "what has this collection
// actually been doing lately," not serve as a full audit log. At the
// default 4-hour schedule, 12 runs is about 2 days of history - plenty to
// spot-check recent behavior without pulling a rotation's entire lifetime
// (which could be thousands of rows for a long-running collection) on every
// page load.
const HISTORY_LIMIT = 12;
const PREVIEW_SLICE = 12;

function parseProductIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function countMoves(before: string[], after: string[]) {
  if (before.length === 0 || after.length === 0) return null;
  const positionBefore = new Map(before.map((id, index) => [id, index]));
  let moved = 0;
  after.forEach((id, index) => {
    const previousIndex = positionBefore.get(id);
    if (previousIndex === undefined || previousIndex !== index) {
      moved += 1;
    }
  });
  return moved;
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

    const rotation = await prisma.collectionRotation.findUnique({
      where: {
        shop_shopifyCollectionId: {
          shop,
          shopifyCollectionId: collection.id,
        },
      },
      select: { id: true },
    });

    if (!rotation) {
      return NextResponse.json({
        ok: true,
        collection: { id: collection.id, title: collection.title },
        runs: [],
      });
    }

    const runs = await prisma.collectionRotationRun.findMany({
      where: { rotationId: rotation.id },
      orderBy: { startedAt: "desc" },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        triggerType: true,
        status: true,
        productCount: true,
        previousProductIds: true,
        shuffledProductIds: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        undoneAt: true,
      },
    });

    // Titles for whatever's in the CURRENT collection - a past run may
    // reference a product that's since been removed, in which case it just
    // falls back to showing the raw product ID below.
    const titleById = new Map(
      collection.products.map((product) => [product.id, product.title])
    );
    const resolveTitles = (ids: string[]) =>
      ids
        .slice(0, PREVIEW_SLICE)
        .map((id) => ({ productId: id, title: titleById.get(id) ?? null }));

    return NextResponse.json({
      ok: true,
      collection: { id: collection.id, title: collection.title },
      runs: runs.map((run) => {
        const previousProductIds = parseProductIds(run.previousProductIds);
        const shuffledProductIds = parseProductIds(run.shuffledProductIds);

        return {
          id: run.id,
          triggerType: run.triggerType,
          status: run.status,
          productCount: run.productCount,
          errorMessage: run.errorMessage,
          startedAt: run.startedAt.toISOString(),
          completedAt: run.completedAt?.toISOString() ?? null,
          undoneAt: run.undoneAt?.toISOString() ?? null,
          movesCount: countMoves(previousProductIds, shuffledProductIds),
          topBefore: resolveTitles(previousProductIds),
          topAfter: resolveTitles(shuffledProductIds),
        };
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load rotation history.",
      },
      { status: 500 }
    );
  }
}
