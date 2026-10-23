import { recommendationHistory } from "./cart-feed";
import crypto from "node:crypto";
import { uniqueDiscount } from "./discounts";
import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "./shopify";
import { Content, DAY, eligible } from "./rules";
import { FlowConfig, validateFlow } from "./flow-config";
import { atomic, json, record, shop, Tx } from "./store";
import { setup } from "./delivery";
import { saveCartConfig, resolveCartConfig, saveCartContent } from "./cart-storage";
import { CART_EXPIRY_MINUTES, CART_UNAVAILABLE_REASON } from "./cart-config";
import { cartMerchandiseBlock, isCartServiceLine, isCartMerchandiseBlock, type CartMerchandise } from "./cart-merchandise";
import { stageCartAbandonment, verifyCartAbandonmentAccess, type CartAbandonment } from "./cart-abandonment";

export type CartRun = {
  config: FlowConfig;
  profileId?: string;
  testEmail?: string;
  productIds: string[];
  url: string;
  observedAt?: string;
  abandonment?: CartAbandonment;
  checkoutCreatedAt?: string;
  completedAt?: string;
  empty?: boolean;
  stockStoppedAt?: string;
  merchandise?: CartMerchandise;
  eligibilityStopped?: string;
  stop?: string;
  lines?: { productId?: string; variantId?: string }[];
};
export type CartLine = {
  product_id?: string | number;
  variant_id?: string | number;
  quantity?: number;
  [key: string]: unknown;
};
export const cartRunKey = (key: string) => key.slice(0, key.lastIndexOf(":"));
export const cartCheckoutKey = (profileId: string, checkout: string) => "cart-v1:" +
  crypto.createHash("sha256").update(shop() + ":" + profileId + ":" + checkout).digest("hex");
export const CART_UNVERIFIED = "Checkout needs a verified Shopify abandonment";
function verifiedAbandonment(proof?: CartAbandonment): proof is CartAbandonment {
  return !!proof && /^gid:\/\/shopify\/Abandonment\/.+/.test(proof.id) &&
    /^gid:\/\/shopify\/AbandonedCheckout\/.+/.test(proof.checkoutId) &&
    Number.isFinite(+new Date(proof.abandonedAt));
}

/** Retire the old update-driven queue in bounded pages, retaining all history. */
export async function reconcileUnverifiedCartMessages() {
  const where = { shop: shop(), kind: "SYSTEM", key: "cart-abandonment-cleanup:v1" };
  const state = await prisma.marketingResource.findUnique({ where: { shop_kind_key: where } });
  const saved = state?.data as { cursor?: string; done?: boolean } | undefined;
  if (saved?.done) return;
  const messages = await prisma.marketingMessage.findMany({ where: { shop: shop(), flowKey: "abandoned-cart",
    flowCondition: { startsWith: "cart-v1:" }, status: "PENDING", ...(saved?.cursor ? { id: { gt: saved.cursor } } : {}) },
    select: { id: true, key: true }, orderBy: { id: "asc" }, take: 500 });
  const roots = [...new Set(messages.map(m => cartRunKey(m.key)))];
  const runs = await prisma.marketingResource.findMany({ where: { shop: shop(), kind: "CART_RUN", key: { in: roots } }, select: { key: true, data: true } });
  const verified = new Set(runs.filter(r => verifiedAbandonment((r.data as unknown as CartRun).abandonment)).map(r => r.key));
  await atomic(async tx => {
    const keys = roots.filter(root => !verified.has(root)).flatMap(root => [root + ":sms", root + ":first", root + ":final"]);
    await tx.marketingMessage.updateMany({ where: { shop: shop(), flowKey: "abandoned-cart", status: "PENDING", key: { in: keys } },
      data: { status: "CANCELLED", error: CART_UNVERIFIED } });
    const data = { ...(messages.length ? { cursor: messages[messages.length - 1].id } : {}), done: messages.length < 500, checkedAt: new Date().toISOString() };
    await tx.marketingResource.upsert({ where: { shop_kind_key: where }, create: { ...where, name: "Retired unverified cart reminders", data }, update: { data } });
  });
}

/** Completion is terminal for this checkout token, including late/out-of-order updates. */
export async function completeCart(tx: Tx, profileId: string, checkout: string, at: Date) {
  const root = cartCheckoutKey(profileId, checkout);
  await tx.marketingResource.updateMany({ where: { shop: shop(), kind: "CART_CANDIDATE", key: root }, data: { enabled: false } });
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
  if (reason === CART_UNAVAILABLE_REASON || isCartMerchandiseBlock(reason)) {
    const run = await tx.marketingResource.findUnique({ where: {
      shop_kind_key: { shop: shop(), kind: "CART_RUN", key: runKey },
    } });
    if (run) await tx.marketingResource.update({ where: { id: run.id }, data: {
      data: json({ ...run.data as object, ...(reason === CART_UNAVAILABLE_REASON
        ? { stockStoppedAt: new Date().toISOString() } : { eligibilityStopped: reason }) }),
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
  const at = new Date(latest.abandonment?.abandonedAt || "");
  const minimum = cartMerchandiseBlock(latest.merchandise, Math.round((run.config.cart?.minimumSubtotal ?? 100) * 100));
  const stop = latest.completedAt ? "Checkout completed" :
    !verifiedAbandonment(latest.abandonment) ? CART_UNVERIFIED :
    owner?.runKey && owner.runKey !== cartRunKey(key) ? "Replaced by the customer's newer checkout" :
    latest.empty ? "Checkout is empty" :
    minimum ? minimum :
    latest.stockStoppedAt ? CART_UNAVAILABLE_REASON :
    +at > Date.now() ? "Shopify abandonment timestamp is in the future" :
    +at < Date.now() - CART_EXPIRY_MINUTES * 60000 ? "Checkout expired" : undefined;
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
  merchandise?: CartMerchandise,
  abandonment?: CartAbandonment,
) {
  if (!Number.isFinite(+at) || !Number.isFinite(+observedAt) || +at > Date.now() || +observedAt > Date.now() + 60000) return false;
  const rootBase = cartCheckoutKey(profileId, checkout);
  const existing = await tx.marketingResource.findFirst({
    where: { shop: shop(), kind: "CART_RUN", OR: [{ key: rootBase }, { key: { startsWith: rootBase + ":attempt-" } }] },
    orderBy: { updatedAt: "desc" },
  });
  const saved = existing?.data as (CartRun & { configRef?: string }) | undefined;
  if (saved?.completedAt) return false;
  const id = (value: unknown) => {
    const result = String(value || "").replace(/^gid:\/\/shopify\/(?:Product|ProductVariant)\//, "");
    return /^\d+$/.test(result) ? result : undefined;
  };
  let cartLines: CartRun["lines"] = lines?.filter(l => (l.quantity === undefined || l.quantity > 0) && !isCartServiceLine(l))
    .map(l => ({ productId: id(l.product_id), variantId: id(l.variant_id) })).slice(0, 100);
  if (merchandise === undefined && lines === undefined) merchandise = saved?.merchandise;
  const eligibility = cartMerchandiseBlock(merchandise, Math.round((config.cart?.minimumSubtotal ?? 100) * 100));
  // A webhook is a context revision, never proof that a person returned or abandoned.
  if (existing && saved && (!saved.observedAt || +observedAt > +new Date(saved.observedAt))) {
    const refreshed = { ...saved, url, observedAt: observedAt.toISOString(),
      merchandise: merchandise ?? { blocked: "Checkout merchandise total is unavailable" },
      ...(eligibility ? { eligibilityStopped: eligibility } : {}),
      ...(cartLines !== undefined ? { productIds: [...new Set(cartLines.flatMap(l => l.productId ? [l.productId] : []))],
        lines: cartLines, empty: cartLines.length === 0 } : {}) };
    await tx.marketingResource.update({ where: { id: existing.id }, data: { data: json(refreshed) } });
    if (eligibility) await cancelCart(tx, existing.key, eligibility);
    else if (refreshed.empty) await cancelCart(tx, existing.key, "Checkout is empty");
  }
  if (!abandonment) {
    await stageCartAbandonment(tx, { profileId, checkout, createdAt: at, url, lines, observedAt, merchandise });
    return false;
  }
  if (!verifiedAbandonment(abandonment)) return false;
  const abandonedAt = new Date(abandonment.abandonedAt);
  if (+abandonedAt > Date.now() || +abandonedAt <= Date.now() - CART_EXPIRY_MINUTES * 60000) return false;
  // A confirmed abandonment can be admitted once, including after stock/consent stops.
  if (saved?.abandonment && (saved.abandonment.id === abandonment.id ||
    +new Date(saved.abandonment.abandonedAt) >= +abandonedAt)) return false;
  const activeWhere = { shop: shop(), kind: "CART_ACTIVE", key: profileId };
  const active = await tx.marketingResource.findUnique({ where: { shop_kind_key: activeWhere } });
  const owner = active?.data as { runKey?: string; abandonedAt?: string } | undefined;
  if (owner?.runKey !== existing?.key && owner?.abandonedAt && +new Date(owner.abandonedAt) >= +abandonedAt) return false;
  if (eligibility || (cartLines !== undefined && !cartLines.length)) return false;
  if (existing) await cancelCart(tx, existing.key, "Superseded by a newer Shopify abandonment");
  const base = existing ? rootBase + ":attempt-" + crypto.createHash("sha256").update(abandonment.id).digest("hex").slice(0, 24) : rootBase;
  // Context already received while Shopify was classifying the checkout takes precedence.
  if (saved?.observedAt && +new Date(saved.observedAt) > +observedAt) {
    observedAt = new Date(saved.observedAt);
    merchandise = saved.merchandise;
    cartLines = saved.lines;
    if (cartMerchandiseBlock(merchandise, Math.round((config.cart?.minimumSubtotal ?? 100) * 100)) || saved.empty) return false;
  }
  if (cartLines === undefined) cartLines = saved?.lines;
  const ids = [...new Set((cartLines || []).flatMap(l => l.productId ? [l.productId] : []))];
  // Preserve the original purchase boundary; only waiting/expiry use abandonment time.
  const triggerAt = at;
  const activate = async (runKey: string) => {
    const data = { runKey, abandonedAt: abandonedAt.toISOString() };
    await tx.marketingResource.upsert({ where: { shop_kind_key: activeWhere },
      create: { ...activeWhere, name: "Current checkout recovery", data }, update: { data } });
    await tx.marketingMessage.updateMany({ where: { shop: shop(), profileId, flowKey: "abandoned-cart", status: "PENDING",
      NOT: { key: { startsWith: runKey + ":" } } }, data: { status: "CANCELLED", error: "Replaced by the customer's newer checkout" } });
  };
  const smsConsent = await tx.marketingConsent.findUnique({
    where: { profileId_channel: { profileId, channel: "SMS_MARKETING" } },
  });
  const profile = await tx.marketingProfile.findUniqueOrThrow({
    where: { id: profileId },
  });
  if (profile.lastOrderAt && profile.lastOrderAt >= triggerAt) return false;
  if (
    config.cart?.testEmail !== undefined &&
    profile.email !== config.cart.testEmail
  )
    return false;
  const sms =
    setup().smsReady && !config.cart?.testEmail && !!profile.phone && eligible(smsConsent);
  const run = {
    configRef: await saveCartConfig(tx, shop(), config),
    ...(config.cart?.testEmail ? { testEmail: config.cart.testEmail } : {}),
    profileId,
    url,
    observedAt: observedAt.toISOString(),
    abandonment,
    checkoutCreatedAt: at.toISOString(),
    merchandise,
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
  await record(tx, { key: "cart-abandonment:" + profileId + ":" + abandonment.id,
    type: "CART_ABANDONMENT_CONFIRMED", profileId, occurredAt: abandonedAt,
    payload: { abandonmentId: abandonment.id, checkoutId: abandonment.checkoutId } });
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
      dueAt: new Date(+abandonedAt + row.minutes * 60000),
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
  return true;
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
  const inactivity = new Date(+new Date(run.abandonment?.abandonedAt || "") + (stage === "sms" ? run.config.smsMinutes ?? 30 : run.config.steps[0].minutes) * 60000);
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
        !isCartServiceLine({ title: product.title }) &&
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
            !isCartServiceLine(p) &&
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
  await verifyCartAbandonmentAccess();
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
