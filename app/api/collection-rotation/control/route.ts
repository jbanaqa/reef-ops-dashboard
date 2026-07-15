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

      assignments:
        rotation?.controlledProducts.map(
          (assignment) => ({
            position:
              assignment.position,
            productId:
              assignment.shopifyProductId,
          })
        ) ?? [],

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

    const rawAssignments =
      Array.isArray(body.assignments)
        ? (body.assignments as ControlledAssignmentInput[])
        : [];

    const productById =
      new Map(
        collection.products.map(
          (product) => [
            product.id,
            product,
          ]
        )
      );

    const usedPositions =
      new Set<number>();

    const usedProductIds =
      new Set<string>();

    const assignments =
      rawAssignments.map(
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
            position >
              controlledTopCount
          ) {
            throw new Error(
              `Position ${position} is outside the controlled range.`
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
              `Position ${position} was assigned more than once.`
            );
          }

          if (
            usedProductIds.has(productId)
          ) {
            throw new Error(
              `${product.title} was assigned more than once.`
            );
          }

          usedPositions.add(position);
          usedProductIds.add(productId);

          return {
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
        assignments.length,
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