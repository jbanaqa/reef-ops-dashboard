import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getShopifyShopDomain, shopifyGraphql } from "@/lib/shopify";

type ShopifyInventoryQuantity = {
  name: string;
  quantity: number;
};

type ShopifyInventoryLevelNode = {
  location: {
    id: string;
    legacyResourceId: string;
    name: string;
  };
  quantities: ShopifyInventoryQuantity[];
};

type ShopifyProductVariantEdge = {
  cursor: string;
  node: {
    id: string;
    legacyResourceId: string;
    title: string;
    product: {
      id: string;
      legacyResourceId: string;
      title: string;
    };
    inventoryItem: {
      id: string;
      legacyResourceId: string;
      sku: string | null;
      tracked: boolean;
      inventoryLevels: {
        nodes: ShopifyInventoryLevelNode[];
      };
    } | null;
  };
};

type ShopifyProductVariantsConnection = {
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
  edges: ShopifyProductVariantEdge[];
};

type ShopifyBaselineResponse = {
  data?: {
    productVariants?: ShopifyProductVariantsConnection;
  };
};

const BASELINE_QUERY = `
  query InventoryBaseline($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          legacyResourceId
          title
          product {
            id
            legacyResourceId
            title
          }
          inventoryItem {
            id
            legacyResourceId
            sku
            tracked
            inventoryLevels(first: 25) {
              nodes {
                location {
                  id
                  legacyResourceId
                  name
                }
                quantities(names: ["available"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }
    }
  }
`;

function getAvailableQuantity(quantities: ShopifyInventoryQuantity[]) {
  const availableQuantity = quantities.find(
    (quantity) => quantity.name === "available"
  );

  return availableQuantity?.quantity ?? 0;
}

export async function POST() {
  try {
    const shop = getShopifyShopDomain();

    const pendingWindowCount = await prisma.inventoryMovementWindow.count({
      where: {
        status: "Pending",
      },
    });

    if (pendingWindowCount > 0) {
      return NextResponse.json(
        {
          error:
            "There are pending inventory movement windows. Finalize or wait for them before syncing a new baseline.",
          pendingWindowCount,
        },
        { status: 409 }
      );
    }

    let after: string | null = null;
    let hasNextPage = true;

    let variantsSeen = 0;
    let trackedVariantsSeen = 0;
    let snapshotsUpserted = 0;
    let locationsSeen = 0;

    while (hasNextPage) {
      const response: ShopifyBaselineResponse =
        await shopifyGraphql<ShopifyBaselineResponse>(BASELINE_QUERY, {
          first: 100,
          after,
        });

      const productVariants: ShopifyProductVariantsConnection | undefined =
        response.data?.productVariants;

      if (!productVariants) {
        throw new Error("Shopify baseline query did not return productVariants.");
      }

      for (const edge of productVariants.edges) {
        const variant = edge.node;
        const inventoryItem = variant.inventoryItem;

        variantsSeen += 1;

        if (!inventoryItem || !inventoryItem.tracked) {
          continue;
        }

        trackedVariantsSeen += 1;

        for (const inventoryLevel of inventoryItem.inventoryLevels.nodes) {
          const available = getAvailableQuantity(inventoryLevel.quantities);

          const inventoryItemId = String(inventoryItem.legacyResourceId);
          const locationId = String(inventoryLevel.location.legacyResourceId);
          const variantId = String(variant.legacyResourceId);
          const productId = String(variant.product.legacyResourceId);

          await prisma.inventorySnapshot.upsert({
            where: {
              shop_inventoryItemId_locationId: {
                shop,
                inventoryItemId,
                locationId,
              },
            },
            update: {
              productId,
              variantId,
              sku: inventoryItem.sku,
              productTitle: variant.product.title,
              variantTitle: variant.title,
              locationName: inventoryLevel.location.name,
              available,
            },
            create: {
              shop,
              productId,
              variantId,
              inventoryItemId,
              locationId,
              sku: inventoryItem.sku,
              productTitle: variant.product.title,
              variantTitle: variant.title,
              locationName: inventoryLevel.location.name,
              available,
            },
          });

          snapshotsUpserted += 1;
          locationsSeen += 1;
        }
      }

      hasNextPage = productVariants.pageInfo.hasNextPage;
      after = productVariants.pageInfo.endCursor;
    }

    return NextResponse.json({
      ok: true,
      message:
        "Baseline sync completed. Current Shopify inventory is now saved as the starting point for future decrements.",
      shop,
      variantsSeen,
      trackedVariantsSeen,
      locationsSeen,
      snapshotsUpserted,
    });
  } catch (error) {
    console.error("Inventory baseline sync error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync inventory baseline.",
      },
      { status: 500 }
    );
  }
}