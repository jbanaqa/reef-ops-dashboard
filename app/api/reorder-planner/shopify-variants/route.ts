import { NextRequest, NextResponse } from "next/server";
import {
  getShopifyShopDomain,
  shopifyGraphql,
} from "@/lib/shopify";

type ShopifyVariantNode = {
  id: string;
  legacyResourceId: string;
  title: string;
  sku: string | null;
  product: {
    id: string;
    legacyResourceId: string;
    title: string;
    status: string;
  };
  inventoryItem: {
    id: string;
    legacyResourceId: string;
  } | null;
};

type ProductVariantsResponse = {
  data?: {
    productVariants?: {
      nodes: ShopifyVariantNode[];
    };
  };
};

const SEARCH_VARIANTS_QUERY = `
  query SearchReorderVariants(
    $first: Int!
    $query: String
  ) {
    productVariants(
      first: $first
      query: $query
      sortKey: RELEVANCE
    ) {
      nodes {
        id
        legacyResourceId
        title
        sku
        product {
          id
          legacyResourceId
          title
          status
        }
        inventoryItem {
          id
          legacyResourceId
        }
      }
    }
  }
`;

function buildShopifySearchQuery(searchText: string) {
  const cleaned = searchText
    .trim()
    .replace(/["\\]/g, " ")
    .replace(/\s+/g, " ");

  if (!cleaned) {
    return null;
  }

  /*
   * Shopify searches both product and variant-related fields.
   * Keeping the search unqualified makes partial product-title,
   * variant-title, and SKU searches more forgiving.
   */
  return cleaned;
}

export async function GET(request: NextRequest) {
  try {
    const searchText =
      request.nextUrl.searchParams.get("q")?.trim() ?? "";

    if (searchText.length < 2) {
      return NextResponse.json({
        variants: [],
      });
    }

    const response =
      await shopifyGraphql<ProductVariantsResponse>(
        SEARCH_VARIANTS_QUERY,
        {
          first: 40,
          query: buildShopifySearchQuery(searchText),
        },
      );

    const shop = getShopifyShopDomain();

    const variants = (
      response.data?.productVariants?.nodes ?? []
    )
      .filter(
        (variant) => variant.product.status === "ACTIVE",
      )
      .map((variant) => ({
        shop,

        productId: String(
          variant.product.legacyResourceId,
        ),

        variantId: String(variant.legacyResourceId),

        inventoryItemId: variant.inventoryItem
          ?.legacyResourceId
          ? String(
              variant.inventoryItem.legacyResourceId,
            )
          : null,

        productTitle: variant.product.title,

        variantTitle:
          variant.title === "Default Title"
            ? null
            : variant.title,

        sku: variant.sku?.trim() || null,
      }));

    return NextResponse.json({
      variants,
    });
  } catch (error) {
    console.error(
      "Failed to search Shopify variants:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Shopify variants could not be loaded.",
      },
      {
        status: 500,
      },
    );
  }
}