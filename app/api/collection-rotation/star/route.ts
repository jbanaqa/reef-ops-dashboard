import {
  NextRequest,
  NextResponse,
} from "next/server";
import { prisma } from "@/lib/prisma";
import { getShopifyShopDomain } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StarRequestBody = {
  collectionId?: unknown;
  collectionTitle?: unknown;
  collectionHandle?: unknown;
  isStarred?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const body =
      (await request.json()) as StarRequestBody;

    const collectionId =
      typeof body.collectionId === "string"
        ? body.collectionId.trim()
        : "";

    const collectionTitle =
      typeof body.collectionTitle === "string"
        ? body.collectionTitle.trim()
        : "";

    const collectionHandle =
      typeof body.collectionHandle === "string"
        ? body.collectionHandle.trim()
        : "";

    if (!collectionId || !collectionTitle) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "collectionId and collectionTitle are required.",
        },
        {
          status: 400,
        }
      );
    }

    if (typeof body.isStarred !== "boolean") {
      return NextResponse.json(
        {
          ok: false,
          error: "isStarred must be a boolean.",
        },
        {
          status: 400,
        }
      );
    }

    const shop = getShopifyShopDomain();

    const rotation =
      await prisma.collectionRotation.upsert({
        where: {
          shop_shopifyCollectionId: {
            shop,
            shopifyCollectionId: collectionId,
          },
        },
        update: {
          collectionTitle,
          collectionHandle:
            collectionHandle || null,
          isStarred: body.isStarred,
        },
        create: {
          shop,
          shopifyCollectionId: collectionId,
          collectionTitle,
          collectionHandle:
            collectionHandle || null,
          isStarred: body.isStarred,
        },
        select: {
          shopifyCollectionId: true,
          isStarred: true,
        },
      });

    return NextResponse.json({
      ok: true,
      collectionId:
        rotation.shopifyCollectionId,
      isStarred: rotation.isStarred,
    });
  } catch (error) {
    console.error(
      "Failed to update collection star:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update collection star.",
      },
      {
        status: 500,
      }
    );
  }
}