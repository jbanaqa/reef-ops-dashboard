import {
  NextRequest,
  NextResponse,
} from "next/server";

import { prisma } from "@/lib/prisma";

import {
  getShopifyShopDomain,
} from "@/lib/shopify";

import {
  getCollectionWithProducts,
} from "@/lib/collection-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ControlledAssignmentInput = {
  position?: unknown;
  productId?: unknown;
};

type SaveControlBody = {
  collectionId?: unknown;
  controlledTopCount?: unknown;
  assignments?: unknown;
  controlledBottomCount?: unknown;
  bottomAssignments?: unknown;
};

function normalizeCollectionId(
  value: unknown
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

export async function GET(
  request: NextRequest
) {
  try {
    const collectionId =
      normalizeCollectionId(
        request.nextUrl.searchParams.get(
          "collectionId"
        )
      );

    if (!collectionId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "collectionId is required.",
        },
        {
          status: 400,
        }
      );
    }

    const shop =
      getShopifyShopDomain();

    const [collection, rotation] =
      await Promise.all([
        getCollectionWithProducts(
          collectionId
        ),

        prisma.collectionRotation.findUnique({
          where: {
            shop_shopifyCollectionId: {
              shop,
              shopifyCollectionId:
                collectionId.startsWith(
                  "gid://"
                )
                  ? collectionId
                  : `gid://shopify/Collection/${collectionId}`,
            },
          },
          include: {
            controlledProducts: {
              orderBy: {
                position: "asc",
              },
            },
          },
        }),
      ]);

    const topAssignments =
      rotation?.controlledProducts
        .filter(
          (assignment) =>
            assignment.zone === "TOP"
        )
        .map((assignment) => ({
          position: assignment.position,
          productId:
            assignment.shopifyProductId,
        })) ?? [];

    const bottomAssignments =
      rotation?.controlledProducts
        .filter(
          (assignment) =>
            assignment.zone === "BOTTOM"
        )
        .map((assignment) => ({
          position: assignment.position,
          productId:
            assignment.shopifyProductId,
        })) ?? [];

    return NextResponse.json({
      ok: true,

      collection: {
        id: collection.id,
        title: collection.title,
        handle: collection.handle,
        productCount:
          collection.products.length,
      },

      controlledTopCount:
        rotation?.controlledTopCount ??
        0,

      assignments: topAssignments,

      controlledBottomCount:
        rotation?.controlledBottomCount ??
        0,

      bottomAssignments: bottomAssignments,

      products:
        collection.products.map(
          (product) => ({
            id: product.id,
            title: product.title,
            handle: product.handle,
            imageUrl:
              product.featuredImage?.url ??
              null,
          })
        ),
    });
  } catch (error) {
    console.error(
      "Failed to load controlled products:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load controlled products.",
      },
      {
        status: 500,
      }
    );
  }
}

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      (await request.json()) as SaveControlBody;

    const collectionId =
      normalizeCollectionId(
        body.collectionId
      );

    if (!collectionId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "collectionId is required.",
        },
        {
          status: 400,
        }
      );
    }

    const collection =
      await getCollectionWithProducts(
        collectionId
      );

    const requestedTopCount =
      typeof body.controlledTopCount ===
      "number"
        ? Math.floor(
            body.controlledTopCount
          )
        : Number(
            body.controlledTopCount
          );

    if (
      !Number.isFinite(
        requestedTopCount
      ) ||
      requestedTopCount < 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "controlledTopCount must be zero or greater.",
        },
        {
          status: 400,
        }
      );
    }

    const controlledTopCount =
      Math.min(
        requestedTopCount,
        collection.products.length
      );

    const requestedBottomCount =
      typeof body.controlledBottomCount ===
      "number"
        ? Math.floor(
            body.controlledBottomCount
          )
        : Number(
            body.controlledBottomCount ?? 0
          );

    if (
      !Number.isFinite(
        requestedBottomCount
      ) ||
      requestedBottomCount < 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "controlledBottomCount must be zero or greater.",
        },
        {
          status: 400,
        }
      );
    }

    // The top and bottom zones can never overlap in the middle of the
    // collection - bottom claims whatever room the top zone hasn't already
    // taken, same "clamp down" behavior controlledTopCount already gets
    // above when it exceeds the collection's actual product count.
    const controlledBottomCount =
      Math.min(
        requestedBottomCount,
        collection.products.length -
          controlledTopCount
      );

    const productById =
      new Map(
        collection.products.map(
          (product) => [
            product.id,
            product,
          ]
        )
      );

    const usedProductIds =
      new Set<string>();

    function parseZoneAssignments(
      zone: "TOP" | "BOTTOM",
      rawInput: unknown,
      zoneCount: number
    ) {
      const rawAssignments =
        Array.isArray(rawInput)
          ? (rawInput as ControlledAssignmentInput[])
          : [];

      const usedPositions =
        new Set<number>();

      return rawAssignments.map(
        (assignment) => {
          const position =
            typeof assignment.position ===
            "number"
              ? Math.floor(
                  assignment.position
                )
              : Number(
                  assignment.position
                );

          const productId =
            typeof assignment.productId ===
            "string"
              ? assignment.productId.trim()
              : "";

          if (
            !Number.isInteger(position) ||
            position < 1 ||
            position > zoneCount
          ) {
            throw new Error(
              `Position ${position} is outside the controlled ${zone === "TOP" ? "top" : "bottom"} range.`
            );
          }

          const product =
            productById.get(productId);

          if (!product) {
            throw new Error(
              "A selected product no longer belongs to this collection."
            );
          }

          if (
            usedPositions.has(position)
          ) {
            throw new Error(
              `${zone === "TOP" ? "Top" : "Bottom"} position ${position} was assigned more than once.`
            );
          }

          if (
            usedProductIds.has(productId)
          ) {
            throw new Error(
              `${product.title} was assigned more than once - a product can only be pinned to one position.`
            );
          }

          usedPositions.add(position);
          usedProductIds.add(productId);

          return {
            zone,
            position,
            shopifyProductId:
              product.id,
            productTitle:
              product.title,
            productHandle:
              product.handle,
            imageUrl:
              product.featuredImage
                ?.url ?? null,
          };
        }
      );
    }

    const topAssignments =
      parseZoneAssignments(
        "TOP",
        body.assignments,
        controlledTopCount
      );

    const bottomAssignments =
      parseZoneAssignments(
        "BOTTOM",
        body.bottomAssignments,
        controlledBottomCount
      );

    const assignments = [
      ...topAssignments,
      ...bottomAssignments,
    ];

    const shop =
      getShopifyShopDomain();

    const rotation =
      await prisma.collectionRotation.upsert({
        where: {
          shop_shopifyCollectionId: {
            shop,
            shopifyCollectionId:
              collection.id,
          },
        },
        update: {
          collectionTitle:
            collection.title,
          collectionHandle:
            collection.handle,
          controlledTopCount,
          controlledBottomCount,
        },
        create: {
          shop,
          shopifyCollectionId:
            collection.id,
          collectionTitle:
            collection.title,
          collectionHandle:
            collection.handle,
          controlledTopCount,
          controlledBottomCount,
        },
      });

    await prisma.$transaction([
      prisma.collectionControlledProduct.deleteMany({
        where: {
          rotationId: rotation.id,
        },
      }),

      ...(assignments.length > 0
        ? [
            prisma.collectionControlledProduct.createMany({
              data: assignments.map(
                (assignment) => ({
                  rotationId:
                    rotation.id,
                  ...assignment,
                })
              ),
            }),
          ]
        : []),
    ]);

    return NextResponse.json({
      ok: true,
      controlledTopCount,
      controlledAssignedCount:
        topAssignments.length,
      controlledBottomCount,
      controlledBottomAssignedCount:
        bottomAssignments.length,
    });
  } catch (error) {
    console.error(
      "Failed to save controlled products:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to save controlled products.",
      },
      {
        status: 500,
      }
    );
  }
}