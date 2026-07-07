import crypto from "crypto";
import { NextResponse } from "next/server";
import { processInventoryUpdate } from "@/lib/inventory-monitor";
import { getInventoryItemDetails } from "@/lib/shopify";

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

    const inventoryItemId = String(payload.inventory_item_id || "");
    const locationId = String(payload.location_id || "");
    const available = Number(payload.available);

    if (!inventoryItemId || !locationId || Number.isNaN(available)) {
      return NextResponse.json(
        {
          error:
            "Webhook payload missing inventory_item_id, location_id, or available.",
        },
        { status: 400 }
      );
    }

    let details = null;

    try {
      details = await getInventoryItemDetails(inventoryItemId);
    } catch (error) {
      console.error("Failed to enrich inventory item details:", error);
    }

    const result = await processInventoryUpdate({
      shop: shopHeader || process.env.SHOPIFY_SHOP_DOMAIN || undefined,
      inventoryItemId,
      locationId,
      available,

      productId: details?.productId || null,
      variantId: details?.variantId || null,
      sku: details?.sku || null,
      productTitle: details?.productTitle || null,
      variantTitle: details?.variantTitle || null,

      rawPayload: payload,
    });

    return NextResponse.json({
      ok: true,
      topic: "inventory_levels/update",
      enriched: Boolean(details),
      details,
      ...result,
    });
  } catch (error) {
    console.error("Shopify inventory webhook error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process Shopify inventory webhook.",
      },
      { status: 500 }
    );
  }
}