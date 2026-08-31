import crypto from "node:crypto";
import type { SpeciesProductSnapshot } from "./macroalgae-shopify";
import { assertSpeciesLibraryShop, normalizeShopDomain } from "./species-library";

export function verifySpeciesWebhook(rawBody: string, hmacHeader: string | null) {
  const secret = process.env.MACROALGAE_SHOPIFY_CLIENT_SECRET;
  if (!secret || !hmacHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const expectedBuffer = Buffer.from(expected); const actualBuffer = Buffer.from(hmacHeader);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export function verifySpeciesWebhookShop(shopHeader: string | null) {
  if (!shopHeader) return false;
  try { return normalizeShopDomain(shopHeader) === assertSpeciesLibraryShop(); }
  catch { return false; }
}

type ProductWebhookPayload = {
  id?: number | string;
  title?: string;
  handle?: string;
  status?: string;
  body_html?: string | null;
  product_type?: string | null;
  vendor?: string | null;
  tags?: string | string[] | null;
  updated_at?: string;
  images?: Array<{ src?: string; url?: string }>;
};

export function productWebhookToSnapshot(payload: ProductWebhookPayload): SpeciesProductSnapshot {
  if (!payload.id || !payload.title || !payload.updated_at) {
    throw new Error("Product webhook is missing id, title, or updated_at.");
  }
  const productId = String(payload.id);
  return {
    id: productId.startsWith("gid://shopify/Product/") ? productId : `gid://shopify/Product/${productId}`,
    title: payload.title,
    handle: payload.handle || "",
    status: String(payload.status || "").toUpperCase(),
    descriptionHtml: payload.body_html || "",
    productType: payload.product_type || "",
    vendor: payload.vendor || "",
    tags: Array.isArray(payload.tags)
      ? payload.tags.map(String)
      : String(payload.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    updatedAt: payload.updated_at,
    imageUrls: Array.isArray(payload.images)
      ? payload.images.map((image) => image.src || image.url || "").filter(Boolean)
      : [],
  };
}
