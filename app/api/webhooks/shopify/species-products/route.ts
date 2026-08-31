import { NextResponse } from "next/server";
import { processSpeciesProduct } from "@/lib/species-product-processor";
import { productWebhookToSnapshot, verifySpeciesWebhook, verifySpeciesWebhookShop } from "@/lib/species-webhook";

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySpeciesWebhook(rawBody, request.headers.get("x-shopify-hmac-sha256"))) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  if (!verifySpeciesWebhookShop(request.headers.get("x-shopify-shop-domain"))) {
    return NextResponse.json({ error: "Shop boundary rejected webhook." }, { status: 403 });
  }
  const topic = request.headers.get("x-shopify-topic");
  if (!new Set(["products/create", "products/update"]).has(topic || "")) {
    return NextResponse.json({ error: "Unsupported webhook topic." }, { status: 400 });
  }

  try {
    const snapshot = productWebhookToSnapshot(JSON.parse(rawBody));
    const result = await processSpeciesProduct(snapshot);
    return NextResponse.json({ ok: true, topic, result });
  } catch (error) {
    console.error("Species product webhook failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook processing failed." }, { status: 500 });
  }
}
