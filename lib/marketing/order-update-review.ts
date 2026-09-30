import { deliveryDateFromTags, deliveryUpsellDueAt, type DeliveryUpsellConfig } from "./delivery-upsell-config";
import { validateFlow } from "./flow-config";
import { shop, type Tx } from "./store";

export async function deliveryReviewConfig(tx: Tx): Promise<DeliveryUpsellConfig | null> {
  const flow = await tx.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "delivery-upsell" } },
  });
  if (!flow) return null;
  try {
    return validateFlow("delivery-upsell", flow.data).delivery || null;
  } catch {
    // An invalid schedule cannot establish that a reminder is expired.
    return null;
  }
}

export function orderUpdateSkipReason(tags: unknown, config: DeliveryUpsellConfig | null, now = new Date()) {
  if (tags == null) return null;
  const delivery = deliveryDateFromTags(tags, now);
  if (!delivery) return "Delivery date removed or invalid";
  if (config) {
    try {
      if (deliveryUpsellDueAt(delivery, config) <= now)
        return "Delivery reminder window passed";
    } catch {
      // A time that cannot be resolved (for example a DST gap) stays held.
    }
  }
  return null;
}
