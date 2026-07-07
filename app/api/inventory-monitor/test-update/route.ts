import { NextResponse } from "next/server";
import { processInventoryUpdate } from "@/lib/inventory-monitor";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const result = await processInventoryUpdate({
      shop: body.shop,
      inventoryItemId: String(body.inventoryItemId || ""),
      locationId: String(body.locationId || ""),
      available: Number(body.available),

      productId: body.productId ? String(body.productId) : null,
      variantId: body.variantId ? String(body.variantId) : null,
      sku: body.sku || null,
      productTitle: body.productTitle || null,
      variantTitle: body.variantTitle || null,
      locationName: body.locationName || null,

      rawPayload: body,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Test inventory update error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process test inventory update.",
      },
      { status: 500 }
    );
  }
}