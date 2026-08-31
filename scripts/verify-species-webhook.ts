import assert from "node:assert/strict";
import crypto from "node:crypto";
import { productWebhookToSnapshot, verifySpeciesWebhook } from "../lib/species-webhook";

process.env.MACROALGAE_SHOPIFY_CLIENT_SECRET = "test-secret";
const raw = JSON.stringify({ id: 123, title: "Purple Tube Anemone", handle: "purple-tube", status: "active", body_html: "<p>Cerianthus sp.</p>", product_type: "Anemone", vendor: "Macroalgae Farms", tags: "anemone, invert", updated_at: "2026-08-31T12:00:00Z", images: [{ src: "https://example.com/image.jpg" }] });
const hmac = crypto.createHmac("sha256", "test-secret").update(raw, "utf8").digest("base64");
assert.equal(verifySpeciesWebhook(raw, hmac), true);
assert.equal(verifySpeciesWebhook(`${raw} `, hmac), false);
assert.equal(verifySpeciesWebhook(raw, "invalid"), false);
const snapshot = productWebhookToSnapshot(JSON.parse(raw));
assert.equal(snapshot.id, "gid://shopify/Product/123");
assert.equal(snapshot.status, "ACTIVE");
assert.deepEqual(snapshot.tags, ["anemone", "invert"]);
assert.deepEqual(snapshot.imageUrls, ["https://example.com/image.jpg"]);
console.log("Species webhook verification passed.");
