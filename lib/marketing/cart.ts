import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "@/lib/shopify";
import { Content, content, DAY, eligible } from "./rules";
import { FlowConfig } from "./flow-config";
import { json, shop, Tx } from "./store";

export type CartRun = {
  config: FlowConfig;
  productIds: string[];
  url: string;
  observedAt?: string;
};
export type CartLine = { product_id?: string | number; quantity?: number };
export const cartRunKey = (key: string) => key.slice(0, key.lastIndexOf(":"));
export async function enrollCart(
  tx: Tx,
  profileId: string,
  checkout: string,
  at: Date,
  config: FlowConfig,
  url: string,
  lines?: CartLine[],
  observedAt = at,
) {
  const base =
    "cart-v1:" +
    crypto
      .createHash("sha256")
      .update(shop() + ":" + profileId + ":" + checkout)
      .digest("hex");
  const existing = await tx.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "CART_RUN", key: base } },
  });
  const ids = [
    ...new Set(
      (lines || [])
        .map((l) =>
          String(l.product_id || "").replace(/^gid:\/\/shopify\/Product\//, ""),
        )
        .filter((id) => /^\d+$/.test(id)),
    ),
  ].slice(0, 100);
  // Refresh checkout items without restarting timers or replacing saved copy.
  if (existing) {
    const saved = existing.data as unknown as CartRun;
    const newer = !saved.observedAt || observedAt > new Date(saved.observedAt);
    if (newer)
      await tx.marketingResource.update({
        where: { id: existing.id },
        data: {
          data: json({
            ...saved,
            url,
            ...(lines !== undefined ? { productIds: ids } : {}),
            observedAt: observedAt.toISOString(),
          }),
        },
      });
    if (newer && lines && !lines.length)
      await tx.marketingMessage.updateMany({
        where: { key: { startsWith: base + ":" }, status: "PENDING" },
        data: { status: "CANCELLED", error: "Checkout is empty" },
      });
    return;
  }
  if (lines && !lines.length) return;
  const smsConsent = await tx.marketingConsent.findUnique({
    where: { profileId_channel: { profileId, channel: "SMS_MARKETING" } },
  });
  const profile = await tx.marketingProfile.findUniqueOrThrow({
    where: { id: profileId },
  });
  if (profile.lastOrderAt && profile.lastOrderAt >= at) return;
  const sms = !!profile.phone && eligible(smsConsent);
  const run: CartRun = {
    config,
    url,
    observedAt: observedAt.toISOString(),
    productIds: ids,
  };
  await tx.marketingResource.create({
    data: {
      shop: shop(),
      kind: "CART_RUN",
      key: base,
      name: "Checkout recovery",
      data: json(run),
    },
  });
  const rows = [
    ...(sms
      ? [
          {
            id: "sms",
            channel: "SMS_MARKETING",
            subject: "Still thinking about those corals?",
            c: config.smsContent!,
            minutes: config.smsMinutes ?? 30,
          },
        ]
      : []),
    {
      id: "first",
      channel: "EMAIL",
      subject: config.steps[0].subject,
      c: config.steps[0].content,
      minutes: (sms ? (config.smsMinutes ?? 30) : 0) + config.steps[0].minutes,
    },
    {
      id: "final",
      channel: "EMAIL",
      subject: config.orderBranch!.no.subject,
      c: config.orderBranch!.no.content,
      minutes:
        (sms ? (config.smsMinutes ?? 30) : 0) +
        config.steps[0].minutes +
        (config.branchMinutes ?? 1440),
    },
  ];
  for (const row of rows)
    await tx.marketingMessage.create({
      data: {
        shop: shop(),
        key: base + ":" + row.id,
        profileId,
        flowKey: "abandoned-cart",
        flowCondition: "cart-v1:" + row.id,
        channel: row.channel,
        subject: row.subject,
        content: json(
          content({ ...row.c, url, products: [], couponCode: undefined }),
        ),
        triggerAt: at,
        dueAt: new Date(+at + row.minutes * 60000),
      },
    });
}

export async function loadCart(key: string): Promise<CartRun> {
  const row = await prisma.marketingResource.findUniqueOrThrow({
    where: {
      shop_kind_key: { shop: shop(), kind: "CART_RUN", key: cartRunKey(key) },
    },
  });
  return row.data as unknown as CartRun;
}

/** Shopify is authoritative even when a purchase webhook is delayed. */
export async function cartLastOrder(
  email: string,
  at: Date,
): Promise<Date | null> {
  const since = new Date(Math.min(+at, Date.now() - 14 * DAY));
  const response = await shopifyGraphql<{
    data?: { orders?: { nodes: { createdAt: string }[] } };
  }>(
    `query CartOrderCheck($query: String!) { orders(first: 1, sortKey: CREATED_AT, reverse: true, query: $query) { nodes { createdAt } } }`,
    {
      query:
        "email:" +
        JSON.stringify(email) +
        " test:false created_at:>=" +
        since.toISOString(),
    },
  );
  if (!response.data?.orders)
    throw new Error("Order history could not be checked");
  return response.data.orders.nodes[0]
    ? new Date(response.data.orders.nodes[0].createdAt)
    : null;
}

/** Return a future time until the previous branch has actually finished. */
export async function cartDependency(
  tx: Tx,
  m: { key: string; flowCondition: string | null; triggerAt: Date | null },
  run: CartRun,
): Promise<Date | null> {
  const stage = m.flowCondition?.split(":")[1];
  if (stage === "sms") return null;
  const previous = await tx.marketingMessage.findUnique({
    where: { key: cartRunKey(m.key) + (stage === "first" ? ":sms" : ":first") },
  });
  if (!previous)
    return stage === "first" ? null : new Date(Date.now() + 900000);
  if (["PENDING", "SENDING", "UNKNOWN"].includes(previous.status))
    return new Date(Math.max(Date.now() + 60000, +previous.dueAt));
  const minutes =
    stage === "first"
      ? run.config.steps[0].minutes
      : (run.config.branchMinutes ?? 1440);
  const due = new Date(
    +(previous.sentAt || previous.updatedAt) + minutes * 60000,
  );
  return due > new Date() ? due : null;
}

type Product = {
  id: string;
  title: string;
  onlineStoreUrl: string | null;
  status: string;
  totalInventory: number;
  tracksInventory: boolean;
  featuredImage?: { url: string } | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
};
export function rankedProducts(
  cart: string[],
  sales: Map<string, number>,
  views: Map<string, number>,
) {
  const sorted = (m: Map<string, number>) =>
    [...m]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id]) => id);
  const best = sorted(sales),
    viewed = sorted(views),
    result = [...cart];
  for (let i = 0; i < Math.max(best.length, viewed.length); i++) {
    if (best[i]) result.push(best[i]);
    if (viewed[i]) result.push(viewed[i]);
  }
  return [...new Set(result)];
}
export async function cartProducts(
  run: CartRun,
): Promise<NonNullable<Content["products"]>> {
  const count = run.config.cart!.productCount;
  if (!count) return [];
  const events = await prisma.marketingEvent.findMany({
    where: {
      shop: shop(),
      type: { in: ["orders/create", "PRODUCT_VIEWED"] },
      occurredAt: { gte: new Date(Date.now() - 3 * DAY), lte: new Date() },
    },
    orderBy: { occurredAt: "desc" },
    take: 10000,
  });
  const sales = new Map<string, number>(),
    views = new Map<string, number>(),
    seenOrders = new Set<string>(),
    seenViews = new Set<string>();
  for (const event of events) {
    const p = event.payload as {
      id?: string | number;
      test?: boolean;
      productId?: string;
      line_items?: CartLine[];
    };
    if (
      event.type === "orders/create" &&
      !p.test &&
      p.id &&
      !seenOrders.has(String(p.id))
    ) {
      seenOrders.add(String(p.id));
      for (const line of p.line_items || []) {
        const id = String(line.product_id || "");
        if (/^\d+$/.test(id))
          sales.set(
            id,
            (sales.get(id) || 0) + Math.max(0, Number(line.quantity) || 0),
          );
      }
    } else if (event.type === "PRODUCT_VIEWED") {
      const id = String(p.productId || "").replace(
        /^gid:\/\/shopify\/Product\//,
        "",
      );
      const unique =
        (event.anonymousId || event.id) +
        ":" +
        id +
        ":" +
        event.occurredAt.toISOString().slice(0, 10);
      if (/^\d+$/.test(id) && !seenViews.has(unique)) {
        seenViews.add(unique);
        views.set(id, (views.get(id) || 0) + 1);
      }
    }
  }
  const ids = rankedProducts(run.productIds, sales, views).slice(0, 100);
  if (!ids.length) return [];
  const response = await shopifyGraphql<{
    data?: { nodes?: (Product | null)[] };
  }>(
    `query CartProducts($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title onlineStoreUrl status totalInventory tracksInventory featuredImage { url } priceRangeV2 { minVariantPrice { amount currencyCode } } } } }`,
    { ids: ids.map((id) => "gid://shopify/Product/" + id) },
  );
  if (!response.data?.nodes) throw new Error("Products could not be checked");
  return response.data.nodes
    .filter(
      (p): p is Product =>
        !!p &&
        p.status === "ACTIVE" &&
        !!p.onlineStoreUrl &&
        (!p.tracksInventory || p.totalInventory > 0),
    )
    .slice(0, count)
    .map((p) => ({
      title: p.title,
      url: p.onlineStoreUrl!,
      image: p.featuredImage?.url,
      price:
        p.priceRangeV2.minVariantPrice.currencyCode +
        " " +
        p.priceRangeV2.minVariantPrice.amount,
    }));
}

/** Persist the random code before contacting Shopify, then look up on every retry. */
export async function cartCoupon(messageId: string) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code =
    "AC300-" +
    Array.from(
      crypto.randomBytes(8),
      (b) => alphabet[b % alphabet.length],
    ).join("");
  const r = await prisma.marketingResource.upsert({
    where: {
      shop_kind_key: { shop: shop(), kind: "CART_COUPON", key: messageId },
    },
    create: {
      shop: shop(),
      kind: "CART_COUPON",
      key: messageId,
      name: "Abandon_Cart10",
      data: { code },
    },
    update: {},
  });
  const saved = r.data as { code: string; discountId?: string };
  if (saved.discountId) return saved.code;
  const title = "Reef Ops Abandon_Cart10 " + messageId;
  const lookup = await shopifyGraphql<{
    data?: {
      codeDiscountNodeByCode: {
        id: string;
        codeDiscount: { title?: string };
      } | null;
    };
  }>(
    `query CartCouponLookup($code: String!) { codeDiscountNodeByCode(code:$code) { id codeDiscount { ... on DiscountCodeBasic { title } } } }`,
    { code: saved.code },
  );
  if (!lookup.data || !("codeDiscountNodeByCode" in lookup.data))
    throw new Error("Discount lookup unavailable");
  let id = lookup.data.codeDiscountNodeByCode?.id;
  if (id && lookup.data.codeDiscountNodeByCode?.codeDiscount.title !== title)
    throw new Error("Discount code conflict; review required");
  if (!id) {
    const start = new Date(),
      end = new Date(start);
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    const result = await shopifyGraphql<{
      data?: {
        discountCodeBasicCreate?: {
          codeDiscountNode?: { id: string } | null;
          userErrors?: { message: string }[];
        };
      };
    }>(
      `mutation CartCouponCreate($input: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount:$input) { codeDiscountNode { id } userErrors { message } } }`,
      {
        input: {
          title,
          code: saved.code,
          context: { all: "ALL" },
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          customerGets: { value: { percentage: 0.1 }, items: { all: true } },
          combinesWith: {
            orderDiscounts: false,
            productDiscounts: false,
            shippingDiscounts: false,
          },
          usageLimit: 1,
          appliesOncePerCustomer: true,
        },
      },
    );
    id = result.data?.discountCodeBasicCreate?.codeDiscountNode?.id;
    if (!id)
      throw new Error(
        result.data?.discountCodeBasicCreate?.userErrors
          ?.map((e) => e.message)
          .join("; ") || "Discount creation unavailable",
      );
  }
  await prisma.marketingResource.update({
    where: { id: r.id },
    data: { data: { code: saved.code, discountId: id } },
  });
  return saved.code;
}
export async function cartReadiness() {
  const r = await shopifyGraphql<{
    data?: {
      currentAppInstallation?: { accessScopes: { handle: string }[] };
      webhookSubscriptions?: { nodes: { topic: string; uri: string }[] };
    };
  }>(
    `query CartReadiness { currentAppInstallation { accessScopes { handle } } webhookSubscriptions(first:250) { nodes { topic uri } } }`,
  );
  if (!r.data?.currentAppInstallation || !r.data.webhookSubscriptions)
    throw new Error("Shopify setup could not be checked.");
  const scopes = new Set(
    r.data.currentAppInstallation.accessScopes.map((s) => s.handle),
  );
  const missing = ["read_orders", "read_products", "write_discounts"].filter(
    (s) =>
      !scopes.has(s) &&
      !(s.startsWith("read_") && scopes.has(s.replace("read_", "write_"))),
  );
  const callback = new URL(
    "/api/marketing/webhooks",
    process.env.APP_BASE_URL!,
  );
  callback.searchParams.set("source", "shopify");
  const topics = new Set(
    r.data.webhookSubscriptions.nodes
      .filter((n) => n.uri === callback.href)
      .map((n) => n.topic),
  );
  const missingWebhooks = [
    "CHECKOUTS_CREATE",
    "CHECKOUTS_UPDATE",
    "ORDERS_CREATE",
  ].filter((t) => !topics.has(t));
  const views = await prisma.marketingEvent.count({
    where: {
      shop: shop(),
      type: "PRODUCT_VIEWED",
      occurredAt: { gte: new Date(Date.now() - 3 * DAY) },
    },
  });
  return {
    ready: missing.length === 0 && missingWebhooks.length === 0,
    missing,
    missingWebhooks,
    views,
  };
}
