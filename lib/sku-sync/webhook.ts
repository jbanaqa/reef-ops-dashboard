import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "../../app/generated/prisma/client";
import { parseInventoryItemId, type StoreSide } from "./shopify";

const MAX_BODY_BYTES = 64 * 1024;

async function readBody(request: Request) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return Buffer.concat(chunks, length);
      length += chunk.value.byteLength;
      if (length > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
}

export function createSkuSyncWebhookReceiver(deps: {
  db: Pick<PrismaClient, "skuSyncWebhookShop" | "skuSyncPair" | "skuSyncWebhookEvent">;
  namespace: () => string;
  secrets: Partial<Record<StoreSide, string>>;
  enabled: boolean;
}) {
  return async function accept(request: Request): Promise<{ status: number; eventId?: string }> {
    const signature = request.headers.get("x-shopify-hmac-sha256");
    if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return { status: 401 };
    const shop = request.headers.get("x-shopify-shop-domain")?.toLowerCase();
    const delivery = request.headers.get("x-shopify-webhook-id");
    if (!shop || !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.myshopify\.com$/.test(shop) ||
      !delivery || !/^[a-zA-Z0-9_-]{1,128}$/.test(delivery) ||
      request.headers.get("x-shopify-topic") !== "inventory_items/update") return { status: 400 };

    let body: Buffer | null;
    try { body = await readBody(request); } catch { return { status: 400 }; }
    if (!body) return { status: 413 };
    const received = Buffer.from(signature, "base64");
    const verify = (secret: string | undefined) => !!secret && timingSafeEqual(
      received, createHmac("sha256", secret).update(body).digest(),
    );
    const matchesA = verify(deps.secrets.A);
    const matchesB = verify(deps.secrets.B);
    if (!matchesA && !matchesB) return { status: 401 };

    try {
      const sourceKey = deps.namespace();
      const identity = await deps.db.skuSyncWebhookShop.findUnique({ where: { sourceKey_shop: { sourceKey, shop } } });
      if (!identity || (identity.side !== "A" && identity.side !== "B") ||
        (identity.side === "A" ? !matchesA : !matchesB)) return { status: 403 };
      if (!deps.enabled) return { status: 204 };

      // Shopify's notification tells us which item to check, not which SKU to write.
      let payload: unknown;
      try { payload = JSON.parse(body.toString("utf8")); } catch { return { status: 400 }; }
      const inventoryItemId = parseInventoryItemId(payload && typeof payload === "object" && "admin_graphql_api_id" in payload
        ? payload.admin_graphql_api_id : undefined);
      if (!inventoryItemId) return { status: 400 };
      const side = identity.side;
      const pairs = await deps.db.skuSyncPair.findMany({
        where: { sourceKey, present: true, active: true,
          ...(side === "A" ? { inventoryItemAId: inventoryItemId } : { inventoryItemBId: inventoryItemId }) },
        select: { variantAId: true, variantBId: true, initializedAt: true },
        take: 2,
      });
      if (pairs.length !== 1 || !pairs[0].initializedAt) return { status: 204 };
      const variantId = side === "A" ? pairs[0].variantAId : pairs[0].variantBId;
      const id = createHash("sha256").update(JSON.stringify([sourceKey, shop, delivery])).digest("hex");
      const receipt = await deps.db.skuSyncWebhookEvent.createMany({
        data: { id, sourceKey, shop, side, variantId }, skipDuplicates: true,
      });
      return receipt.count === 1 ? { status: 204, eventId: id } : { status: 204 };
    } catch {
      // No acknowledgement until durable storage succeeds. Shopify will retry a 5xx response.
      return { status: 503 };
    }
  };
}
