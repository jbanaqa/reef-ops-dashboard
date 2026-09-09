import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "@/lib/shopify";
import { atomic, identify, json, record, shop } from "./store";
import { content, defaultContent, marketingSettings } from "./rules";
import { StockConfig, stockCopy, validateStock } from "./stock-config";

export type StockVariant = {
  id: string;
  title: string;
  inventoryQuantity: number | null;
  inventoryItem: { tracked: boolean };
  product: { id: string; title: string; handle: string };
};
type Page = {
  data?: {
    collection?: { id: string; title: string } | null;
    productVariants?: {
      nodes: StockVariant[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
};
const query = `query MarketingStockVariants($id: ID!, $query: String!, $after: String) {
  collection(id: $id) { id title }
  productVariants(first: 100, query: $query, after: $after, sortKey: ID) {
    nodes { id title inventoryQuantity inventoryItem { tracked } product { id title handle } }
    pageInfo { hasNextPage endCursor }
  }
}`;
export async function readStock(s: StockConfig) {
  const variants: StockVariant[] = [];
  const observedAt = new Date();
  let after: string | null = null,
    collectionName = "";
  const cursors = new Set<string>();
  for (let page = 0; page < 50; page++) {
    if (Date.now() - +observedAt > 60000)
      throw new Error(
        "Stock check took too long. No inventory state was changed; retry later.",
      );
    const response: Page = await shopifyGraphql<Page>(query, {
      id: "gid://shopify/Collection/" + s.collectionId,
      query: "collection:" + s.collectionId,
      after,
    });
    if (!response.data?.collection)
      throw new Error("Collection not found or Shopify access is unavailable.");
    collectionName = response.data.collection.title;
    const connection = response.data.productVariants;
    if (!connection || !Array.isArray(connection.nodes))
      throw new Error("Shopify did not return complete stock data.");
    variants.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage)
      return { variants, collectionName, observedAt };
    after = connection.pageInfo.endCursor;
    if (!after || cursors.has(after))
      throw new Error("Shopify inventory pagination did not advance.");
    cursors.add(after);
  }
  throw new Error(
    "Collection exceeds 5,000 variants. Narrow the collection before enabling alerts.",
  );
}
export function stockStateKey(s: StockConfig, id: string) {
  const scope = crypto
    .createHash("sha256")
    .update(s.collectionId + ":" + s.threshold)
    .digest("hex")
    .slice(0, 16);
  return "v2:" + scope + ":" + id.replace("gid://shopify/ProductVariant/", "");
}
export async function observeStock(
  s: StockConfig,
  variant: StockVariant,
  observedAt: Date,
  expectedConfig: string,
) {
  if (
    !variant.inventoryItem.tracked ||
    !Number.isInteger(variant.inventoryQuantity)
  )
    return 0;
  const quantity = variant.inventoryQuantity!;
  return atomic(async (tx) => {
    const flow = await tx.marketingResource.findUnique({
      where: {
        shop_kind_key: { shop: shop(), kind: "FLOW", key: "low-stock" },
      },
    });
    if (
      !flow?.enabled ||
      JSON.stringify(flow.data) !== expectedConfig ||
      !(flow.data as { reviewed?: boolean }).reviewed
    )
      return 0;
    const key = stockStateKey(s, variant.id);
    const previous = await tx.marketingResource.findUnique({
      where: { shop_kind_key: { shop: shop(), kind: "STOCK", key } },
    });
    const old = previous?.data as
      | { low?: boolean; observedAt?: string; cycle?: number }
      | undefined;
    if (old?.observedAt && new Date(old.observedAt) >= observedAt) return 0;
    const low = quantity < s.threshold;
    const crossed = !!old && old.low === false && low;
    const cycle = (old?.cycle || 0) + (crossed ? 1 : 0);
    const data = json({
      low,
      quantity,
      cycle,
      observedAt: observedAt.toISOString(),
      variantId: variant.id,
      productTitle: variant.product.title,
      variantTitle: variant.title,
    });
    await tx.marketingResource.upsert({
      where: { shop_kind_key: { shop: shop(), kind: "STOCK", key } },
      create: {
        shop: shop(),
        kind: "STOCK",
        key,
        name: variant.product.title,
        data,
      },
      update: { data },
    });
    if (!low)
      await tx.marketingMessage.updateMany({
        where: {
          shop: shop(),
          flowKey: "low-stock",
          status: "PENDING",
          flowCondition: { startsWith: "stock:" + key + ":" },
        },
        data: { status: "CANCELLED", error: "Stock recovered before delivery" },
      });
    if (!crossed) return 0;
    const profile = await identify(tx, {
      email: s.recipientEmail,
      ...(s.recipientPhone ? { phone: s.recipientPhone } : {}),
    });
    const productUrl =
      "https://" +
      shop() +
      "/products/" +
      encodeURIComponent(variant.product.handle);
    const values = {
      ProductTitle: variant.product.title,
      VariantTitle: variant.title,
      InventoryQuantity: String(quantity),
      ProductURL: productUrl,
    };
    const condition = "stock:" + key + ":" + cycle;
    let queued = 0;
    for (const channel of [
      ...(s.emailEnabled ? ["EMAIL"] : []),
      ...(s.smsEnabled ? ["SMS_TRANSACTIONAL"] : []),
    ]) {
      const body = stockCopy(
        channel === "EMAIL" ? s.emailBody : s.smsBody,
        values,
      );
      const c = content({
        ...defaultContent,
        heading: "Low stock alert",
        preview: "Internal inventory alert",
        body,
        bodyHtml: undefined,
        url: productUrl,
        button: "View product",
      });
      await tx.marketingMessage.upsert({
        where: { key: condition + ":" + profile.id + ":" + channel },
        create: {
          shop: shop(),
          key: condition + ":" + profile.id + ":" + channel,
          flowKey: "low-stock",
          flowCondition: condition,
          profileId: profile.id,
          channel,
          subject: stockCopy(s.emailSubject, values)
            .replace(/[\r\n]/g, " ")
            .slice(0, 200),
          content: json(c),
          dueAt: new Date(),
          triggerAt: observedAt,
        },
        update: {},
      });
      queued++;
    }
    await record(tx, {
      key: condition,
      type: "LOW_STOCK",
      profileId: profile.id,
      occurredAt: observedAt,
      payload: {
        product: variant.product.title,
        variant: variant.title,
        quantity,
        threshold: s.threshold,
      },
    });
    return queued;
  });
}
export async function lowStock() {
  const resource = await prisma.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "low-stock" } },
  });
  if (!resource?.enabled) return { skipped: "Stock flow paused" };
  const flow = resource.data as { reviewed?: boolean; stock?: unknown };
  if (!flow.reviewed) return { skipped: "Stock flow needs review" };
  const settings = await prisma.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" } },
  });
  if (
    process.env.MARKETING_INGEST_ENABLED !== "true" ||
    !marketingSettings(settings?.data).operations.ingestEnabled
  )
    return { skipped: "Shopify ingestion paused" };
  const s = validateStock(flow.stock, true);
  const snapshot = await readStock(s);
  let queued = 0;
  for (const variant of snapshot.variants)
    queued += await observeStock(
      s,
      variant,
      snapshot.observedAt,
      JSON.stringify(resource.data),
    );
  const result = {
    observedAt: snapshot.observedAt.toISOString(),
    at: new Date().toISOString(),
    collection: snapshot.collectionName,
    checked: snapshot.variants.length,
    low: snapshot.variants.filter(
      (v) =>
        v.inventoryItem.tracked &&
        v.inventoryQuantity !== null &&
        v.inventoryQuantity < s.threshold,
    ).length,
    queued,
  };
  await prisma.marketingResource.upsert({
    where: {
      shop_kind_key: { shop: shop(), kind: "SYSTEM", key: "stock-check" },
    },
    create: {
      shop: shop(),
      kind: "SYSTEM",
      key: "stock-check",
      name: "Last stock check",
      data: json(result),
    },
    update: { data: json(result) },
  });
  return result;
}
