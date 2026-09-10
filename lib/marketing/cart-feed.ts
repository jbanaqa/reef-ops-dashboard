import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { shop } from "./store";
import { DAY } from "./rules";
import { productIdsFromEvent } from "./cart-history";

/** Keyset pagination avoids silently truncating a busy shop's feed history. */
export async function* feedEvents(where: Prisma.MarketingEventWhereInput) {
  let cursor: string | undefined;
  const deadline = Date.now() + 20000;
  for (;;) {
    if (Date.now() > deadline)
      throw new Error(
        "Recommendation history is taking longer than expected. The email will retry.",
      );
    const page = await prisma.marketingEvent.findMany({
      where: {
        AND: [
          where,
          { shop: shop() },
          ...(cursor ? [{ id: { gt: cursor } }] : []),
        ],
      },
      orderBy: { id: "asc" },
      take: 1000,
      select: {
        id: true,
        type: true,
        profileId: true,
        anonymousId: true,
        payload: true,
        occurredAt: true,
      },
    });
    for (const event of page) yield event;
    if (page.length < 1000) break;
    cursor = page[page.length - 1].id;
  }
}
export async function recommendationHistory(profileId?: string) {
  const now = new Date();
  const profile = profileId
    ? await prisma.marketingProfile.findFirst({
        where: { id: profileId, shop: shop() },
        select: { email: true },
      })
    : null;
  const cart: string[] = [];
  if (profileId) {
    const matched: Prisma.MarketingEventWhereInput[] = [{ profileId }];
    if (profile?.email)
      matched.push({ payload: { path: ["email"], equals: profile.email } });
    const rows = [];
    for await (const e of feedEvents({
      OR: matched,
      type: {
        in: [
          "checkouts/create",
          "checkouts/update",
          "ADDED_TO_CART",
          "HISTORY_CART",
          "HISTORY_CHECKOUT",
        ],
      },
      occurredAt: { gte: new Date(+now - 90 * DAY), lte: now },
      createdAt: { lte: now },
    }))
      rows.push(e);
    rows.sort(
      (a, b) => +b.occurredAt - +a.occurredAt || a.id.localeCompare(b.id),
    );
    for (const e of rows) {
      const p = e.payload as { productIds?: string[] };
      cart.push(...(p.productIds || productIdsFromEvent(p)));
    }
  }
  const sync = await prisma.marketingResource.findUnique({
    where: {
      shop_kind_key: { shop: shop(), kind: "HISTORY_SYNC", key: "klaviyo" },
    },
  });
  const coverage = (
    sync?.data as
      | { coverage?: { until: string; metrics: string[] } }
      | undefined
  )?.coverage;
  const cutover = coverage ? new Date(coverage.until) : null;
  const hasViews = !!cutover && coverage!.metrics.includes("Viewed Product");
  const hasSales = !!cutover && coverage!.metrics.includes("Ordered Product");
  const sales = new Map<string, number>(),
    views = new Map<string, number>(),
    orders = new Set<string>();
  const add = (map: Map<string, number>, id: string, n: number) =>
    map.set(id, (map.get(id) || 0) + n);
  for await (const e of feedEvents({
    type: {
      in: ["orders/create", "PRODUCT_VIEWED", "HISTORY_VIEW", "HISTORY_SALE"],
    },
    occurredAt: { gte: new Date(+now - 3 * DAY), lte: now },
    createdAt: { lte: now },
  })) {
    const p = e.payload as {
      id?: string | number;
      test?: boolean;
      productIds?: string[];
      quantity?: number;
      line_items?: { product_id?: string | number; quantity?: number }[];
    };
    if (e.type === "HISTORY_VIEW" && hasViews && e.occurredAt < cutover!)
      for (const id of p.productIds || []) add(views, id, 1);
    if (e.type === "HISTORY_SALE" && hasSales && e.occurredAt < cutover!)
      for (const id of p.productIds || [])
        add(sales, id, Math.max(1, p.quantity || 1));
    if (e.type === "PRODUCT_VIEWED" && (!hasViews || e.occurredAt >= cutover!))
      for (const id of productIdsFromEvent(p)) add(views, id, 1);
    if (
      e.type === "orders/create" &&
      (!hasSales || e.occurredAt >= cutover!) &&
      !p.test &&
      p.id &&
      !orders.has(String(p.id))
    ) {
      orders.add(String(p.id));
      for (const l of p.line_items || []) {
        const id = String(l.product_id || "");
        if (/^\d+$/.test(id))
          add(sales, id, Math.max(0, Number(l.quantity) || 0));
      }
    }
  }
  return { cart: [...new Set(cart)], sales, views };
}
