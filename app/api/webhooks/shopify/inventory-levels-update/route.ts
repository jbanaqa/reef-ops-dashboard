import crypto from "crypto";
import { NextResponse } from "next/server";
import { processInventoryUpdate } from "@/lib/inventory-monitor";
import { processProductRestockWaitlist } from "@/lib/product-restock-waitlist";
import {
  getInventoryItemDetails,
  getProductInventoryDetails,
} from "@/lib/shopify";

function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string | null
) {
  const secret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!secret) {
    throw new Error(
      "Missing SHOPIFY_CLIENT_SECRET environment variable."
    );
  }

  if (!hmacHeader) {
    return false;
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const digestBuffer = Buffer.from(
    digest,
    "utf8"
  );
  const hmacBuffer = Buffer.from(
    hmacHeader,
    "utf8"
  );

  if (digestBuffer.length !== hmacBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    digestBuffer,
    hmacBuffer
  );
}

export async function POST(request: Request) {
  try {
    /*
      Shopify signs the exact raw request body.
      Read it before parsing JSON.
    */
    const rawBody = await request.text();

    const hmacHeader = request.headers.get(
      "x-shopify-hmac-sha256"
    );
    const shopHeader = request.headers.get(
      "x-shopify-shop-domain"
    );

    const isValid = verifyShopifyWebhook(
      rawBody,
      hmacHeader
    );

    if (!isValid) {
      return NextResponse.json(
        {
          error:
            "Invalid Shopify webhook signature.",
        },
        {
          status: 401,
        }
      );
    }

    const payload = JSON.parse(rawBody);

    const inventoryItemId = String(
      payload.inventory_item_id || ""
    );
    const locationId = String(
      payload.location_id || ""
    );
    const available = Number(payload.available);

    if (
      !inventoryItemId ||
      !locationId ||
      Number.isNaN(available)
    ) {
      return NextResponse.json(
        {
          error:
            "Webhook payload is missing inventory_item_id, location_id, or available.",
        },
        {
          status: 400,
        }
      );
    }

    const shop =
      shopHeader ||
      process.env.SHOPIFY_SHOP_DOMAIN ||
      "unknown-shop";

    /*
      Identify the Shopify variant and its parent
      product from the inventory item in the webhook.
    */
    let details = null;

    try {
      details =
        await getInventoryItemDetails(
          inventoryItemId
        );
    } catch (error) {
      console.error(
        "Failed to enrich inventory item details:",
        error
      );
    }

    /*
      Preserve the existing inventory-monitor workflow.
      The restock system uses a separate authoritative
      product-level total from Shopify.
    */
    const inventoryResult =
      await processInventoryUpdate({
        shop,
        inventoryItemId,
        locationId,
        available,

        productId: details?.productId || null,
        variantId: details?.variantId || null,
        sku: details?.sku || null,
        productTitle:
          details?.productTitle || null,
        variantTitle:
          details?.variantTitle || null,

        rawPayload: payload,
      });

    let restockWaitlist = null;

    try {
      /*
        Ask Shopify for the entire product's current
        inventory total. This includes all variants,
        so the alert remains product-level.
      */
      const productInventory = details?.productId
        ? await getProductInventoryDetails(
            details.productId
          )
        : null;

      restockWaitlist =
        await processProductRestockWaitlist({
          shop,
          productId:
            productInventory?.productId ||
            details?.productId ||
            null,
          productHandle:
            productInventory?.productHandle ||
            details?.productHandle ||
            null,
          productTitle:
            productInventory?.productTitle ||
            details?.productTitle ||
            null,
          currentProductTotal:
            productInventory?.totalAvailable ??
            null,
        });
    } catch (error) {
      console.error(
        "Failed to process product restock waitlist:",
        error
      );

      restockWaitlist = {
        action: "restock_waitlist_error",
        error:
          error instanceof Error
            ? error.message
            : "Failed to process the product restock waitlist.",
      };
    }

    return NextResponse.json({
      ok: true,
      topic: "inventory_levels/update",
      enriched: Boolean(details),
      details,
      restockWaitlist,
      ...inventoryResult,
    });
  } catch (error) {
    console.error(
      "Shopify inventory webhook error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process Shopify inventory webhook.",
      },
      {
        status: 500,
      }
    );
  }
}