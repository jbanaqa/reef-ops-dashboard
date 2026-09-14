import { recommendationHistory } from "./cart-feed";
import crypto from "node:crypto";
import { uniqueDiscount } from "./discounts";
import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "@/lib/shopify";
import { Content, content, DAY, eligible } from "./rules";
import { FlowConfig, validateFlow } from "./flow-config";
import { json, shop, Tx } from "./store";

export type CartRun = {
  config: FlowConfig;
  profileId?: string;
  testEmail?: string;
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
  const rootBase =
    "cart-v1:" +
    crypto
      .createHash("sha256")
      .update(shop() + ":" + profileId + ":" + checkout)
      .digest("hex");
  let base = rootBase;
  let triggerAt = at;
  const existing = await tx.marketingResource.findFirst({
    where: {
      shop: shop(),
      kind: "CART_RUN",
      OR: [{ key: rootBase }, { key: { startsWith: rootBase + ":attempt-" } }],
    },
    orderBy: { updatedAt: "desc" },
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
  // Refresh an active attempt without restarting its timers. Shopify can reuse
  // a checkout token after a customer returns days later, so stale activity
  // creates a new attempt and leaves the completed attempt in history.
  if (existing) {
    const saved = existing.data as unknown as CartRun;
    const newer = !saved.observedAt || observedAt > new Date(saved.observedAt);
    const stale =
      !saved.observedAt ||
      observedAt.getTime() - new Date(saved.observedAt).getTime() > 3 * DAY;
    const pending = await tx.marketingMessage.findMany({
      where: { key: { startsWith: existing.key + ":" }, status: "PENDING" },
      select: { dueAt: true },
    });
    const overdue = pending.some(
      (message) => message.dueAt.getTime() < observedAt.getTime() - 3 * DAY,
    );
    if (!newer) return;
    if (lines && !lines.length) {
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
      await tx.marketingMessage.updateMany({
        where: {
          key: { startsWith: existing.key + ":" },
          status: "PENDING",
        },
        data: { status: "CANCELLED", error: "Checkout is empty" },
      });
      return;
    }
    if (!stale && !overdue) {
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
      return;
    }
    await tx.marketingMessage.updateMany({
      where: {
        key: { startsWith: existing.key + ":" },
        status: "PENDING",
      },
      data: {
        status: "CANCELLED",
        error: "Superseded by new checkout activity",
      },
    });
    base = rootBase + ":attempt-" + observedAt.getTime();
    triggerAt = observedAt;
  }
  if (lines && !lines.length) return;
  const smsConsent = await tx.marketingConsent.findUnique({
    where: { profileId_channel: { profileId, channel: "SMS_MARKETING" } },
  });
  const profile = await tx.marketingProfile.findUniqueOrThrow({
    where: { id: profileId },
  });
  if (profile.lastOrderAt && profile.lastOrderAt >= triggerAt) return;
  if (
    config.cart?.testEmail !== undefined &&
    profile.email !== config.cart.testEmail
  )
    return;
  const sms =
    !config.cart?.testEmail && !!profile.phone && eligible(smsConsent);
  const run: CartRun = {
    config,
    ...(config.cart?.testEmail ? { testEmail: config.cart.testEmail } : {}),
    profileId,
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
  for (const row of rows) {
    const data = {
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
      triggerAt,
      dueAt: new Date(+triggerAt + row.minutes * 60000),
    };
    if (config.cart?.testEmail) {
      await tx.marketingMessage.upsert({
        where: { key: data.key },
        create: data,
        update: {
          ...data,
          status: "PENDING",
          attemptedAt: null,
          sentAt: null,
          providerId: null,
          attempts: 0,
          error: null,
        },
      });
    } else await tx.marketingMessage.create({ data });
  }
}

export async function loadCart(key: string): Promise<CartRun> {
  const row = await prisma.marketingResource.findUniqueOrThrow({
    where: {
      shop_kind_key: { shop: shop(), kind: "CART_RUN", key: cartRunKey(key) },
    },
  });
  const run = row.data as unknown as CartRun;
  if (!run.profileId) {
    const message = await prisma.marketingMessage.findUnique({
      where: { key },
      select: { profileId: true },
    });
    run.profileId = message?.profileId;
  }
  const flow = await prisma.marketingResource.findUnique({
    where: {
      shop_kind_key: { shop: shop(), kind: "FLOW", key: "abandoned-cart" },
    },
  });
  if (flow?.data && (flow.data as { cart?: unknown }).cart) {
    const live = validateFlow("abandoned-cart", flow.data);
    run.config = {
      ...run.config,
      steps: run.config.steps.map((step, index) =>
        index === 0
          ? {
              ...step,
              subject: live.steps[0].subject,
              content: live.steps[0].content,
            }
          : step,
      ),
      orderBranch: live.orderBranch,
      cart: live.cart,
    };
  }
  return run;
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
  const current = await tx.marketingMessage.findUnique({
    where: { key: m.key },
    select: { id: true },
  });
  if (
    current &&
    (await tx.marketingResource.findUnique({
      where: {
        shop_kind_key: { shop: shop(), kind: "CART_WAIT", key: current.id },
      },
    }))
  )
    return null;
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
  const history = await recommendationHistory(run.profileId);
  const ids = rankedProducts(
    [...run.productIds, ...history.cart],
    history.sales,
    history.views,
  );
  if (!ids.length) return [];
  const result: NonNullable<Content["products"]> = [];
  for (
    let offset = 0;
    offset < ids.length && result.length < count;
    offset += 100
  ) {
    const batch = ids.slice(offset, offset + 100);
    const response = await shopifyGraphql<{
      data?: { nodes?: (Product | null)[] };
    }>(
      `query CartProducts($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title onlineStoreUrl status totalInventory tracksInventory featuredImage { url } priceRangeV2 { minVariantPrice { amount currencyCode } } } } }`,
      { ids: batch.map((id) => "gid://shopify/Product/" + id) },
    );
    if (!response.data?.nodes) throw new Error("Products could not be checked");
    result.push(
      ...response.data.nodes
        .filter(
          (p): p is Product =>
            !!p &&
            p.status === "ACTIVE" &&
            !/\bshipping[\s-]+(?:protection|box(?:es)?)\b/i.test(p.title) &&
            !!p.onlineStoreUrl &&
            (!p.tracksInventory || p.totalInventory > 0),
        )
        .slice(0, count - result.length)
        .map((p) => ({
          title: p.title,
          url: p.onlineStoreUrl!,
          image: p.featuredImage?.url,
          price:
            p.priceRangeV2.minVariantPrice.currencyCode +
            " " +
            p.priceRangeV2.minVariantPrice.amount,
        })),
    );
  }
  return result;
}

export async function cartCoupon(messageId: string) {
  return (await uniqueDiscount(messageId, { kind: "CART_COUPON", name: "Abandon_Cart10", prefix: "AC300-" })).code;
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

/** Start the next wait once. Later timing edits cannot move a wait already entered. */
export async function advanceCart(
  tx: Tx,
  message: { key: string; flowCondition: string | null },
  completedAt = new Date(),
) {
  if (!message.flowCondition?.startsWith("cart-v1:")) return;
  const stage = message.flowCondition.split(":")[1];
  if (stage !== "sms" && stage !== "first") return;
  const next = await tx.marketingMessage.findUnique({
    where: {
      key: cartRunKey(message.key) + (stage === "sms" ? ":first" : ":final"),
    },
  });
  if (!next || next.status !== "PENDING") return;
  const where = { shop: shop(), kind: "CART_WAIT", key: next.id };
  if (
    await tx.marketingResource.findUnique({ where: { shop_kind_key: where } })
  )
    return;
  const row = await tx.marketingResource.findUnique({
    where: {
      shop_kind_key: { shop: shop(), kind: "FLOW", key: "abandoned-cart" },
    },
  });
  const live = validateFlow("abandoned-cart", row?.data);
  const delay =
    stage === "sms" ? live.steps[0].minutes : (live.branchMinutes ?? 1440);
  const dueAt = new Date(+completedAt + delay * 60000);
  await tx.marketingResource.create({
    data: {
      ...where,
      name: "Cart wait started",
      data: { dueAt: dueAt.toISOString() },
    },
  });
  await tx.marketingMessage.update({
    where: { id: next.id },
    data: { dueAt, error: null },
  });
}
