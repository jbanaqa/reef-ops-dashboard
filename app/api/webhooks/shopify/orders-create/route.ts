import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null) {
  const secret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!secret) {
    throw new Error("Missing SHOPIFY_CLIENT_SECRET in .env.local");
  }

  if (!hmacHeader) {
    return false;
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const digestBuffer = Buffer.from(digest, "utf8");
  const hmacBuffer = Buffer.from(hmacHeader, "utf8");

  if (digestBuffer.length !== hmacBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(digestBuffer, hmacBuffer);
}

function normalizeOptionalString(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return String(value);
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();

    const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
    const shopHeader = request.headers.get("x-shopify-shop-domain");

    const isValid = verifyShopifyWebhook(rawBody, hmacHeader);

    if (!isValid) {
      return NextResponse.json(
        {
          error: "Invalid Shopify webhook signature.",
        },
        { status: 401 }
      );
    }

    const payload = JSON.parse(rawBody);

    const shop = shopHeader || process.env.SHOPIFY_SHOP_DOMAIN || "unknown-shop";
    const orderId = String(payload.id || "");
    const orderName = normalizeOptionalString(payload.name);
    const orderCreatedAt = payload.created_at
      ? new Date(payload.created_at)
      : new Date();

    if (!orderId) {
      return NextResponse.json(
        {
          error: "Webhook payload missing order id.",
        },
        { status: 400 }
      );
    }

    const existingClaims = await prisma.orderInventoryClaim.count({
      where: {
        shop,
        orderId,
      },
    });

    if (existingClaims > 0) {
      return NextResponse.json({
        ok: true,
        topic: "orders/create",
        action: "duplicate_order_ignored",
        orderId,
        orderName,
        existingClaims,
      });
    }

    const lineItems = Array.isArray(payload.line_items)
      ? payload.line_items
      : [];

    const claimMap = new Map<
      string,
      {
        productId: string | null;
        variantId: string | null;
        inventoryItemId: string | null;
        sku: string | null;
        productTitle: string | null;
        variantTitle: string | null;
        quantitySold: number;
      }
    >();

    for (const lineItem of lineItems) {
      const quantitySold = Number(lineItem.quantity || 0);

      if (quantitySold <= 0) {
        continue;
      }

      const variantId = normalizeOptionalString(lineItem.variant_id);
      const productId = normalizeOptionalString(lineItem.product_id);
      const sku = normalizeOptionalString(lineItem.sku);
      const productTitle = normalizeOptionalString(lineItem.title);
      const variantTitle = normalizeOptionalString(lineItem.variant_title);

      const key = variantId || `${productId || "unknown"}:${sku || "no-sku"}`;

      const existing = claimMap.get(key);

      if (existing) {
        existing.quantitySold += quantitySold;
      } else {
        claimMap.set(key, {
          productId,
          variantId,
          inventoryItemId: null,
          sku,
          productTitle,
          variantTitle,
          quantitySold,
        });
      }
    }

    const claimsToCreate = Array.from(claimMap.values()).filter(
      (claim) => claim.variantId || claim.sku || claim.productTitle
    );

    if (claimsToCreate.length === 0) {
      return NextResponse.json({
        ok: true,
        topic: "orders/create",
        action: "no_inventory_claims_created",
        orderId,
        orderName,
        lineItemsSeen: lineItems.length,
      });
    }

    await prisma.orderInventoryClaim.createMany({
      data: claimsToCreate.map((claim) => ({
        shop,
        orderId,
        orderName,

        productId: claim.productId,
        variantId: claim.variantId,
        inventoryItemId: claim.inventoryItemId,

        sku: claim.sku,
        productTitle: claim.productTitle,
        variantTitle: claim.variantTitle,

        quantitySold: claim.quantitySold,
        claimedQuantity: 0,
        orderCreatedAt,
      })),
    });

    return NextResponse.json({
      ok: true,
      topic: "orders/create",
      action: "claims_created",
      orderId,
      orderName,
      lineItemsSeen: lineItems.length,
      claimsCreated: claimsToCreate.length,
    });
  } catch (error) {
    console.error("Shopify orders/create webhook error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process Shopify orders/create webhook.",
      },
      { status: 500 }
    );
  }
}