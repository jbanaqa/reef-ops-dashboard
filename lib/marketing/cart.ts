import { recommendationHistory } from "./cart-feed";
import crypto from "node:crypto";
import { uniqueDiscount } from "./discounts";
import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "@/lib/shopify";
import { Content, DAY, eligible } from "./rules";
import { FlowConfig, validateFlow } from "./flow-config";
import { json, shop, Tx } from "./store";
import { setup } from "./delivery";
import { saveCartConfig, resolveCartConfig, saveCartContent } from "./cart-storage";
import { CART_EXPIRY_MINUTES, CART_UNAVAILABLE_REASON } from "./cart-config";

export type CartRun = {
  config: FlowConfig;
  profileId?: string;
  testEmail?: string;
  productIds: string[];
  url: string;
  observedAt?: string;
  completedAt?: string;
  empty?: boolean;
  stockStoppedAt?: string;
  stop?: string;
  lines?: { productId?: string; variantId?: string }[];
};
export type CartLine = { product_id?: string | number; variant_id?: string | number; quantity?: number };
export const cartRunKey = (key: string) => key.slice(0, key.lastIndexOf(":"));
export const cartCheckoutKey = (profileId: string, checkout: string) => "cart-v1:" +
  crypto.createHash("sha256").update(shop() + ":" + profileId + ":" + checkout).digest("hex");

/** Completion is terminal for this checkout token, including late/out-of-order updates. */
export async function completeCart(tx: Tx, profileId: string, checkout: string, at: Date) {
  const root = cartCheckoutKey(profileId, checkout);
  const runs = await tx.marketingResource.findMany({ where: {
    shop: shop(), kind: "CART_RUN", OR: [{ key: root }, { key: { startsWith: root + ":attempt-" } }],
  } });
  for (const run of runs) await tx.marketingResource.update({ where: { id: run.id }, data: {
    data: json({ ...(run.data as object), completedAt: at.toISOString() }),
  } });
  if (!runs.length) await tx.marketingResource.create({ data: {
    shop: shop(), kind: "CART_RUN", key: root, name: "Completed checkout",
    data: { profileId, completedAt: at.toISOString() },
  } });
  await tx.marketingMessage.updateMany({ where: {
    shop: shop(), profileId, flowKey: "abandoned-cart", status: "PENDING", key: { startsWith: root + ":" },
  }, data: { status: "CANCELLED", error: "Checkout completed" } });
}
/** Cancel pending steps while retaining delivery and content history. */
export async function cancelCart(tx: Tx, runKey: string, reason: string) {
  if (reason === CART_UNAVAILABLE_REASON) {
    const run = await tx.marketingResource.findUnique({ where: {
      shop_kind_key: { shop: shop(), kind: "CART_RUN", key: runKey },
    } });
    if (run) await tx.marketingResource.update({ where: { id: run.id }, data: {
      data: json({ ...run.data as object, stockStoppedAt: new Date().toISOString() }),
    } });
  }
  await tx.marketingMessage.updateMany({ where: { shop: shop(), flowKey: "abandoned-cart",
    key: { in: [runKey + ":sms", runKey + ":first", runKey + ":final"] }, status: "PENDING" }, data: { status: "CANCELLED", error: reason } });
}

/** Read ownership/activity inside the claim and again immediately before sending. */
export async function currentCart(tx: Tx, key: string, run: CartRun): Promise<CartRun & { stop?: string }> {
  const row = await tx.marketingResource.findUniqueOrThrow({ where: {
    shop_kind_key: { shop: shop(), kind: "CART_RUN", key: cartRunKey(key) },
  } });
  const latest = { ...run, ...row.data as object, config: run.config } as CartRun;
  const active = latest.profileId ? await tx.marketingResource.findUnique({ where: {
    shop_kind_key: { shop: shop(), kind: "CART_ACTIVE", key: latest.profileId },
  } }) : null;
  const owner = active?.data as { runKey?: string } | undefined;
  const at = new Date(latest.observedAt || "");
  const stop = latest.completedAt ? "Checkout completed" :
    owner?.runKey && owner.runKey !== cartRunKey(key) ? "Replaced by the customer's newer checkout" :
    latest.empty ? "Checkout is empty" :
    latest.stockStoppedAt ? CART_UNAVAILABLE_REASON :
    !Number.isFinite(+at) || +at < Date.now() - CART_EXPIRY_MINUTES * 60000 ? "Checkout expired" : undefined;
  return { ...latest, ...(stop ? { stop } : {}) };
}

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
  const rootBase = cartCheckoutKey(profileId, checkout);
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
  const id = (value: unknown) => {
    const result = String(value || "").replace(/^gid:\/\/shopify\/(?:Product|ProductVariant)\//, "");
    return /^\d+$/.test(result) ? result : undefined;
  };
  let cartLines: CartRun["lines"] = lines?.filter(l => l.quantity === undefined || l.quantity > 0)
    .map(l => ({ productId: id(l.product_id), variantId: id(l.variant_id) })).slice(0, 100);
  let ids = [...new Set((cartLines || []).flatMap(l => l.productId ? [l.productId] : []))];
  const activeWhere = { shop: shop(), kind: "CART_ACTIVE", key: profileId };
  const active = await tx.marketingResource.findUnique({ where: { shop_kind_key: activeWhere } });
  const owner = active?.data as { runKey: string; observedAt: string } | undefined;
  // A delayed webhook must not replace a newer checkout for the same customer.
  if (owner && owner.runKey !== existing?.key && new Date(owner.observedAt) >= observedAt) return;
  const activate = async (runKey: string) => {
    await tx.marketingResource.upsert({ where: { shop_kind_key: activeWhere },
      create: { ...activeWhere, name: "Current checkout recovery", data: { runKey, observedAt: observedAt.toISOString() } },
      update: { data: { runKey, observedAt: observedAt.toISOString() } } });
    await tx.marketingMessage.updateMany({ where: {
      shop: shop(), profileId, flowKey: "abandoned-cart", status: "PENDING",
      NOT: { key: { startsWith: runKey + ":" } },
    }, data: { status: "CANCELLED", error: "Replaced by the customer's newer checkout" } });
  };
  if (existing) {
    const saved = existing.data as unknown as CartRun & { configRef?: string };
    if (saved.completedAt) return;
    if (saved.observedAt && observedAt <= new Date(saved.observedAt)) return;
    const stale = !saved.observedAt || +observedAt - +new Date(saved.observedAt) > 3 * DAY;
    const replaced = !!owner && owner.runKey !== existing.key;
    // Recognize stock stops from the previous release as well as the durable marker.
    const stockStopped = saved.stockStoppedAt || await tx.marketingMessage.findFirst({ where: {
      shop: shop(), key: { in: [existing.key + ":first", existing.key + ":final"] },
      status: "CANCELLED", error: CART_UNAVAILABLE_REASON,
    }, select: { id: true } });
    const refill = (saved.empty && cartLines && cartLines.length > 0) ||
      (stockStopped && (cartLines === undefined || cartLines.length > 0));
    const refreshed = { ...saved, url, observedAt: observedAt.toISOString(),
      ...(cartLines !== undefined ? { productIds: ids, lines: cartLines, empty: cartLines.length === 0 } : {}) };
    if (!stale && !replaced && !refill) {
      await tx.marketingResource.update({ where: { id: existing.id }, data: { data: json(refreshed) } });
      await activate(existing.key);
      if (refreshed.empty) await cancelCart(tx, existing.key, "Checkout is empty");
      else {
        const entered = saved.configRef ? await resolveCartConfig(tx, shop(), saved.configRef) : saved.config || config;
        const dueAt = new Date(+observedAt + entered.steps[0].minutes * 60000);
        await tx.marketingMessage.updateMany({ where: { shop: shop(), key: { startsWith: existing.key + ":" },
          channel: "EMAIL", status: "PENDING", dueAt: { lt: dueAt } }, data: { dueAt, error: "Waiting for checkout inactivity" } });
      }
      return;
    }
    await cancelCart(tx, existing.key, "Superseded by new checkout activity");
    if (cartLines === undefined) { cartLines = saved.lines; ids = saved.productIds || []; }
    base = rootBase + ":attempt-" + observedAt.getTime();
    triggerAt = observedAt;
  }
  if (cartLines && !cartLines.length) {
    await tx.marketingResource.create({ data: { shop: shop(), kind: "CART_RUN", key: base,
      name: "Empty checkout", data: { profileId, url, productIds: [], lines: [], empty: true, observedAt: observedAt.toISOString() } } });
    await activate(base);
    return;
  }
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
    setup().smsReady && !config.cart?.testEmail && !!profile.phone && eligible(smsConsent);
  const run = {
    configRef: await saveCartConfig(tx, shop(), config),
    ...(config.cart?.testEmail ? { testEmail: config.cart.testEmail } : {}),
    profileId,
    url,
    observedAt: observedAt.toISOString(),
    productIds: ids,
    ...(cartLines !== undefined ? { lines: cartLines } : {}),
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
  await activate(base);
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
      content: await saveCartContent(tx, shop(), { ...row.c, url, products: [], couponCode: undefined }),
      triggerAt,
      dueAt: new Date(+observedAt + row.minutes * 60000),
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
  const stored = row.data as unknown as CartRun & { configRef?: string };
  const { configRef, ...values } = stored;
  const run: CartRun = {
    ...values,
    config: configRef ? await resolveCartConfig(prisma, shop(), configRef) : stored.config,
  };
  if (!run.config) throw new Error("Checkout has no active recovery run");
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
  const current = await tx.marketingMessage.findUnique({ where: { key: m.key }, select: { id: true } });
  const wait = current ? await tx.marketingResource.findUnique({ where: {
    shop_kind_key: { shop: shop(), kind: "CART_WAIT", key: current.id },
  } }) : null;
  const stage = m.flowCondition?.split(":")[1];
  const previous = stage === "sms" ? null : await tx.marketingMessage.findUnique({
    where: { key: cartRunKey(m.key) + (stage === "first" ? ":sms" : ":first") },
  });
  if (previous && ["PENDING", "SENDING", "UNKNOWN"].includes(previous.status))
    return new Date(Math.max(Date.now() + 60000, +previous.dueAt));
  const savedWait = wait?.data as { dueAt?: string; testAdvance?: boolean } | undefined;
  if (run.testEmail && savedWait?.testAdvance) return null;
  const inactivity = new Date(+new Date(run.observedAt!) + (stage === "sms" ? run.config.smsMinutes ?? 30 : run.config.steps[0].minutes) * 60000);
  let due = +inactivity;
  if (previous && !savedWait?.dueAt) {
    const minutes = stage === "first" ? run.config.steps[0].minutes : (run.config.branchMinutes ?? 1440);
    due = Math.max(due, +(previous.sentAt || previous.updatedAt) + minutes * 60000);
  }
  if (savedWait?.dueAt) due = Math.max(due, +new Date(savedWait.dueAt));
  return due > Date.now() ? new Date(due) : null;
}

/** A cancelled or failed first email can never become a final offer. */
export async function cartSequenceStop(tx: Tx, key: string, condition: string | null) {
  if (!condition?.startsWith("cart-v1:final")) return null;
  const first = await tx.marketingMessage.findUnique({ where: { key: cartRunKey(key) + ":first" } });
  return !first || ["CANCELLED", "FAILED"].includes(first.status) || (first.status === "SENT" && !first.sentAt) ? "First reminder was not sent" : null;
}

/** Check checkout variants, independently of optional recommendation cards. */
export async function cartPurchasable(run: CartRun): Promise<boolean> {
  const lines: NonNullable<CartRun["lines"]> = run.lines ?? run.productIds.map(productId => ({ productId }));
  if (!lines.length) throw new Error("Waiting for checkout line items");
  const ids = [...new Set(lines.flatMap(line => line.variantId
    ? ["gid://shopify/ProductVariant/" + line.variantId]
    : line.productId ? ["gid://shopify/Product/" + line.productId] : []))];
  if (!ids.length) throw new Error("Checkout items could not be identified");
  type SaleProduct = { status: string; onlineStoreUrl: string | null; title: string };
  type SaleNode = SaleProduct & { availableForSale?: boolean; product?: SaleProduct; variants?: { nodes: { availableForSale: boolean }[] } };
  // Bound the nested legacy-product connection cost below Shopify's per-query limit.
  for (let offset = 0; offset < ids.length; offset += 8) {
    const batch = ids.slice(offset, offset + 8);
    const response = await shopifyGraphql<{ data?: { nodes?: (SaleNode | null)[] } }>(
      `query CartAvailability($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { availableForSale product { status onlineStoreUrl title } } ... on Product { status onlineStoreUrl title variants(first: 100) { nodes { availableForSale } } } } }`, { ids: batch });
    if (!response.data?.nodes || response.data.nodes.length !== batch.length)
      throw new Error("Checkout availability could not be checked");
    if (response.data.nodes.some(node => {
      if (!node) return false;
      const product = node.product || node;
      return product.status === "ACTIVE" && !!product.onlineStoreUrl &&
        !/\bshipping[\s-]+(?:protection|box(?:es)?)\b/i.test(product.title) &&
        (node.product ? node.availableForSale === true : node.variants?.nodes.some(v => v.availableForSale));
    })) return true;
  }
  if (lines.some(line => !line.variantId && !line.productId)) throw new Error("Some checkout items could not be identified");
  return false;
}

type Product = {
  id: string;
  title: string;
  onlineStoreUrl: string | null;
  status: string;
  totalInventory: number;
  tracksInventory: boolean;
  featuredImage?: { url: string } | null;
  variants: {
    nodes: {
      availableForSale: boolean;
      price: string;
      compareAtPrice: string | null;
    }[];
  };
};
function cartMoney(value: string | null, currency = "USD") {
  if (!value) return undefined;
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
      })
    : undefined;
}
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
      `query CartProducts($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title onlineStoreUrl status totalInventory tracksInventory featuredImage { url } variants(first: 100) { nodes { availableForSale price compareAtPrice } } } } }`,
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
            p.variants.nodes.some((variant) => variant.availableForSale) &&
            (!p.tracksInventory || p.totalInventory > 0),
        )
        .slice(0, count - result.length)
        .map((p) => {
          const variant = p.variants.nodes
            .filter((item) => item.availableForSale)
            .sort((a, b) => Number(a.price) - Number(b.price))[0];
          const compareAtPrice =
            Number(variant.compareAtPrice) > Number(variant.price)
              ? cartMoney(variant.compareAtPrice)
              : undefined;
          return {
            title: p.title,
            url: p.onlineStoreUrl!,
            image: p.featuredImage?.url,
            price: cartMoney(variant.price),
            compareAtPrice,
          };
        }),
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
  if (stage === "first") {
    const first = await tx.marketingMessage.findUnique({ where: { key: message.key } });
    if (first?.status !== "SENT" || !first.sentAt) {
      if (first && ["CANCELLED", "FAILED"].includes(first.status))
        await cancelCart(tx, cartRunKey(message.key), "First reminder was not sent");
      return;
    }
    completedAt = first.sentAt;
  }
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
