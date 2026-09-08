/* Shopify Settings > Customer events > Add custom pixel.
 * Require marketing and analytics consent in the pixel's privacy settings.
 * Replace REEF_OPS_ORIGIN before connecting. No credentials belong in this file.
 * Browser events are anonymous observations; server webhooks own orders and consent.
 */
const REEF_OPS_ORIGIN = "https://YOUR-REEF-OPS-HOST";
const events = { product_viewed: "PRODUCT_VIEWED", product_added_to_cart: "ADDED_TO_CART", checkout_started: "CHECKOUT_STARTED" };
for (const [name, type] of Object.entries(events)) {
  analytics.subscribe(name, async event => {
    try {
      await fetch(`${REEF_OPS_ORIGIN}/api/marketing/storefront`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "event", type, id: event.id, anonymousId: event.clientId, productId: event.data?.productVariant?.product?.id || event.data?.cartLine?.merchandise?.product?.id || "" }), keepalive: true });
    } catch { /* A failed analytics observation must not interfere with checkout. */ }
  });
}
