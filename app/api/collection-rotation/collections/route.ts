import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getShopifyShopDomain,
} from "@/lib/shopify";
import {
  listShopifyCollections,
} from "@/lib/collection-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const shop =
      getShopifyShopDomain();

    const [collections, rotations] =
      await Promise.all([
        listShopifyCollections(),

        prisma.collectionRotation.findMany({
          where: {
            shop,
          },

          include: {
            controlledProducts: {
              select: {
                id: true,
              },
            },

            runs: {
              where: {
                status: "Completed",
                undoneAt: null,
                triggerType: {
                  in: [
                    "Manual",
                    "Batch",
                    "Scheduled",
                  ],
                },
              },

              orderBy: {
                completedAt: "desc",
              },

              take: 1,

              select: {
                id: true,
                completedAt: true,
              },
            },
          },
        }),
      ]);

    const rotationByCollectionId =
      new Map(
        rotations.map((rotation) => [
          rotation.shopifyCollectionId,
          rotation,
        ])
      );

    const collectionResults =
      collections
        .map((collection) => {
          const rotation =
            rotationByCollectionId.get(
              collection.id
            );

          return {
            ...collection,

            isStarred:
              rotation?.isStarred ??
              false,

            isEnabled:
              rotation?.isEnabled ??
              false,

            controlledTopCount:
              rotation
                ?.controlledTopCount ??
              0,

            controlledAssignedCount:
              rotation
                ?.controlledProducts
                .length ?? 0,

            lastShuffledAt:
              rotation?.lastShuffledAt
                ?.toISOString() ??
              null,

            lastStatus:
              rotation?.lastStatus ??
              null,

            lastError:
              rotation?.lastError ??
              null,

            canUndo: Boolean(
              rotation?.runs[0]
            ),
          };
        })
        .sort((first, second) => {
          if (
            first.isStarred !==
            second.isStarred
          ) {
            return first.isStarred
              ? -1
              : 1;
          }

          if (
            first.productsCount !==
            second.productsCount
          ) {
            return (
              second.productsCount -
              first.productsCount
            );
          }

          return first.title.localeCompare(
            second.title
          );
        });

    return NextResponse.json({
      ok: true,
      collections:
        collectionResults,
    });
  } catch (error) {
    console.error(
      "Failed to load Shopify collections:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Failed to load Shopify collections.",
      },
      {
        status: 500,
      }
    );
  }
}