import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { attributionConfiguration, attributedOrders } from "./attribution";
import { customerFlowMessages } from "./cart-report-scope";
import { compactOrderEvidence, orderValue, type OrderEvidence } from "./order-evidence";
import { DAY } from "./rules";
import { shop } from "./store";
import { welcomeLabels } from "./welcome-config";

export type ReportedFlow = "welcome" | "abandoned-cart";
const periods = new Set([7, 30, 90, 365]);
type Metrics = {
  sent: number; recipients: number; delivered: number; opened: number; clicked: number;
  bounced: number; complained: number; unsubscribed: number; waiting: number;
  stopped: number; needsAttention: number; orders: number; convertedRecipients: number;
  revenue: Record<string, number>;
};
const metrics = (): Metrics => ({ sent: 0, recipients: 0, delivered: 0, opened: 0, clicked: 0,
  bounced: 0, complained: 0, unsubscribed: 0, waiting: 0, stopped: 0, needsAttention: 0,
  orders: 0, convertedRecipients: 0, revenue: {} });
const cartNames: Record<string, string> = { first: "Email #1 · Soft push", "final-yes": "Email #2 · Another soft push",
  "final-no": "Email #2 · Discount offer", final: "Follow-up · awaiting decision" };
const eventMetric = { DELIVERED: "delivered", OPENED: "opened", CLICKED: "clicked", BOUNCED: "bounced",
  COMPLAINED: "complained", UNSUBSCRIBED: "unsubscribed" } as const;
type OrderPayload = OrderEvidence & { orderId?: unknown; orderLabel?: string; currency?: string; revenue?: unknown };
const numericOrderId = (payload: OrderPayload) => {
  const value = String(payload.orderId || "").replace(/^gid:\/\/shopify\/Order\//, "");
  return /^\d+$/.test(value) ? value : null;
};

/** One sent-date cohort and the same single winning email as the campaign/global reports. */
export async function flowReport(flowKey: ReportedFlow, requestedDays = 30, requestedPage = 1) {
  if (!["welcome", "abandoned-cart"].includes(flowKey)) throw Error("Choose Welcome or Abandoned Cart.");
  const days = periods.has(requestedDays) ? requestedDays : 30;
  const now = new Date(), since = new Date(+now - days * DAY);
  const attribution = await attributionConfiguration(prisma);
  const name = flowKey === "welcome" ? "Welcome" : "Abandoned Cart";
  const totals = metrics();
  const steps = (flowKey === "welcome" ? welcomeLabels.map((label, index) => [String(index), label])
    : Object.entries(cartNames)).map(([key, label]) => ({ key, label, ...metrics() }));
  const byKey = new Map(steps.map(step => [step.key, step]));
  const recipientSets = new Map<Metrics, Set<string>>(), buyerSets = new Map<Metrics, Set<string>>();
  for (const row of [totals, ...steps]) { recipientSets.set(row, new Set()); buyerSets.set(row, new Set()); }
  const stepFor = (message: { flowStep: number | null; flowCondition: string | null }) => {
    const key = flowKey === "welcome" ? String(message.flowStep ?? 0)
      : message.flowCondition?.replace("cart-v1:", "") || "first";
    if (!byKey.has(key)) {
      const row = { key, label: flowKey === "welcome" ? "Welcome email" : "Cart email", ...metrics() };
      steps.push(row); byKey.set(key, row); recipientSets.set(row, new Set()); buyerSets.set(row, new Set());
    }
    return byKey.get(key)!;
  };
  const selection = { id: true, key: true, flowKey: true, profileId: true, flowStep: true, flowCondition: true,
    subject: true, status: true, error: true, triggerAt: true, dueAt: true, createdAt: true, sentAt: true,
    profile: { select: { email: true } } } as const;
  const sentMessages = new Map<string, Prisma.MarketingMessageGetPayload<{ select: typeof selection }>>();
  const recent: { id: string; profileId: string; email: string; subject: string; step: string; status: string;
    triggerAt: string | null; dueAt: string; sentAt: string | null; error: string | null; sortAt: string }[] = [];
  const reasons = new Map<string, number>();
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.marketingMessage.findMany({ where: {
      shop: shop(), flowKey, channel: "EMAIL", campaignId: null,
      OR: [{ sentAt: { gte: since, lte: now } }, { sentAt: null, createdAt: { gte: since, lte: now } }],
      ...(cursor ? { id: { gt: cursor } } : {}),
    }, orderBy: { id: "asc" }, take: 500, select: selection });
    const customerMessages = await customerFlowMessages(prisma, shop(), page);
    for (const message of customerMessages) {
      const step = stepFor(message);
      for (const row of [totals, step]) {
        if (message.sentAt) { row.sent++; recipientSets.get(row)!.add(message.profileId); }
        if (["PENDING", "SENDING"].includes(message.status)) row.waiting++;
        if (message.status === "CANCELLED") row.stopped++;
        if (["FAILED", "UNKNOWN"].includes(message.status)) row.needsAttention++;
      }
      if (message.sentAt) sentMessages.set(message.id, message);
      if (message.error && message.status !== "SENT") reasons.set(message.error, (reasons.get(message.error) || 0) + 1);
      recent.push({ id: message.id, profileId: message.profileId, email: message.profile.email || "Email unavailable",
        subject: message.subject, step: step.label, status: message.status, triggerAt: message.triggerAt?.toISOString() || null,
        dueAt: message.dueAt.toISOString(), sentAt: message.sentAt?.toISOString() || null, error: message.error,
        sortAt: (message.sentAt || message.createdAt).toISOString() });
    }
    recent.sort((a, b) => b.sortAt.localeCompare(a.sortAt) || b.id.localeCompare(a.id));
    recent.splice(25);
    const ids = customerMessages.filter(message => message.sentAt).map(message => message.id);
    if (ids.length) {
      const events = await prisma.marketingEvent.findMany({ where: {
        shop: shop(), messageId: { in: ids }, type: { in: Object.keys(eventMetric) }, occurredAt: { lte: now },
      }, distinct: ["messageId", "type"], orderBy: { occurredAt: "desc" },
      select: { messageId: true, type: true, occurredAt: true } });
      for (const event of events) {
        const message = sentMessages.get(event.messageId!), field = eventMetric[event.type as keyof typeof eventMetric];
        if (!message?.sentAt || event.occurredAt < message.sentAt || !field) continue;
        totals[field]++; stepFor(message)[field]++;
      }
    }
    if (page.length < 500) break;
    cursor = page[page.length - 1].id;
  }

  const orders: { id: string; label: string; shopifyUrl: string | null; profileId: string | null; email: string;
    placedAt: string; sentAt: string; subject: string; step: string; amount: number | null; currency: string | null;
    interaction: "OPENED" | "CLICKED"; interactedAt: string; checkoutMatch: boolean | null; discountCodes: string[] }[] = [];
  const details = new Map<string, { payload: OrderPayload; messageId: string; occurredAt: Date; profileId: string | null }>();
  for await (const { order, match } of attributedOrders(prisma, { since, until: now, flowKey, configuration: attribution })) {
    const message = match ? sentMessages.get(match.messageId) : undefined;
    if (!message?.sentAt || !match) continue;
    const step = stepFor(message), payload = order.payload as OrderPayload;
    const { amount, currency } = orderValue(payload), id = numericOrderId(payload);
    for (const row of [totals, step]) {
      row.orders++; buyerSets.get(row)!.add(message.profileId);
      if (amount !== null && currency) row.revenue[currency] = (row.revenue[currency] || 0) + amount;
    }
    orders.push({ id: order.id, label: payload.orderLabel || (id ? "Order " + id : "Order number unavailable"),
      shopifyUrl: id ? `https://${shop()}/admin/orders/${id}` : null, profileId: message.profileId,
      email: message.profile.email || "Email unavailable", placedAt: order.occurredAt.toISOString(),
      sentAt: message.sentAt.toISOString(), subject: message.subject, step: step.label, amount,
      currency, interaction: match.interaction,
      interactedAt: match.interactedAt.toISOString(), checkoutMatch: null, discountCodes: [] });
    details.set(order.id, { payload, messageId: message.id, occurredAt: order.occurredAt, profileId: order.profileId });
  }
  // Older compact ORDER records lack evidence. Reuse small fields from retained
  // Shopify events when possible; do not copy raw orders or private checkout URLs.
  const missing = [...details.values()].filter(detail => detail.payload.checkoutKey === undefined || detail.payload.discountCodes === undefined);
  const orderIds = [...new Set(missing.flatMap(detail => numericOrderId(detail.payload) || []))];
  for (let index = 0; index < orderIds.length; index += 100) {
    const sources = await prisma.$queryRaw<{ orderId: string; checkout: string | null; hasCheckout: boolean; codes: unknown; label: string | null }[]>(Prisma.sql`
      SELECT "payload"->>'id' AS "orderId",
        (ARRAY_AGG("payload"->>'checkout_token' ORDER BY "occurredAt" DESC, id DESC)
          FILTER (WHERE "payload" ? 'checkout_token'))[1] AS checkout,
        BOOL_OR("payload" ? 'checkout_token') AS "hasCheckout",
        (ARRAY_AGG("payload"->'discount_codes' ORDER BY "occurredAt" DESC, id DESC)
          FILTER (WHERE jsonb_typeof("payload"->'discount_codes') = 'array'))[1] AS codes,
        (ARRAY_AGG(COALESCE(NULLIF("payload"->>'name', ''), NULLIF("payload"->>'order_number', ''))
          ORDER BY "occurredAt" DESC, id DESC) FILTER (WHERE COALESCE(NULLIF("payload"->>'name', ''),
            NULLIF("payload"->>'order_number', '')) IS NOT NULL))[1] AS label
      FROM "MarketingEvent" WHERE shop=${shop()} AND type IN ('orders/create', 'orders/updated')
        AND "payload"->>'id' IN (${Prisma.join(orderIds.slice(index, index + 100))})
      GROUP BY "payload"->>'id'`);
    for (const source of sources) for (const [eventId, detail] of details) {
      if (numericOrderId(detail.payload) !== source.orderId || !detail.profileId) continue;
      const evidence = compactOrderEvidence(detail.profileId, {
        ...(source.hasCheckout ? { checkout_token: source.checkout } : {}),
        ...(Array.isArray(source.codes) ? { discount_codes: source.codes } : {}),
      });
      detail.payload = { ...evidence, ...detail.payload };
      if (!detail.payload.orderLabel && source.label) orders.find(order => order.id === eventId)!.label = source.label;
    }
  }
  // Allocate code evidence only to a real message sent before the order. A shared
  // Welcome coupon may appear in several emails, but an order is still counted once.
  const coupons = new Map<string, { code: string; sentAt: Date }[]>();
  const couponMessages = new Map<string, { profileId: string; sentAt: Date }[]>();
  const buyerProfiles = new Set([...details.values()].flatMap(detail => detail.profileId || []));
  for (const message of sentMessages.values()) {
    if (!buyerProfiles.has(message.profileId) || (flowKey === "welcome" && (message.flowStep ?? 0) >= 3)) continue;
    const key = flowKey === "welcome" ? message.profileId : message.id;
    const list = couponMessages.get(key) || [];
    list.push({ profileId: message.profileId, sentAt: message.sentAt! }); couponMessages.set(key, list);
  }
  const keys = [...couponMessages.keys()];
  for (let index = 0; index < keys.length; index += 500) {
    const page = await prisma.marketingResource.findMany({ where: { shop: shop(),
      kind: flowKey === "welcome" ? "WELCOME_COUPON" : "CART_COUPON", key: { in: keys.slice(index, index + 500) },
    }, select: { key: true, data: true } });
    for (const coupon of page) {
      const data = coupon.data as { code?: unknown };
      if (typeof data.code !== "string" || !data.code.trim()) continue;
      for (const message of couponMessages.get(coupon.key) || []) {
        const list = coupons.get(message.profileId) || [];
        list.push({ code: data.code.trim().toUpperCase(), sentAt: message.sentAt });
        coupons.set(message.profileId, list);
      }
    }
  }
  const evidence = { matchingCheckoutOrders: 0, discountOrders: 0, missingCheckoutDetails: 0 };
  for (const order of orders) {
    const detail = details.get(order.id)!, message = sentMessages.get(detail.messageId)!;
    if (flowKey === "abandoned-cart" && message.key.startsWith("cart-v1:")) {
      const checkoutKey = message.key.slice(0, message.key.lastIndexOf(":")).replace(/:attempt-[^:]+$/, "");
      order.checkoutMatch = detail.payload.checkoutKey === undefined ? null : detail.payload.checkoutKey === checkoutKey;
      if (order.checkoutMatch) evidence.matchingCheckoutOrders++;
      if (order.checkoutMatch === null) evidence.missingCheckoutDetails++;
    }
    const used = new Set((detail.payload.discountCodes || []).filter(code => typeof code === "string").map(code => code.trim().toUpperCase()));
    order.discountCodes = [...new Set((coupons.get(message.profileId) || [])
      .filter(coupon => coupon.sentAt <= detail.occurredAt && used.has(coupon.code)).map(coupon => coupon.code))];
    if (order.discountCodes.length) evidence.discountOrders++;
  }
  for (const row of [totals, ...steps]) {
    row.recipients = recipientSets.get(row)!.size; row.convertedRecipients = buyerSets.get(row)!.size;
  }
  orders.sort((a, b) => b.placedAt.localeCompare(a.placedAt) || b.id.localeCompare(a.id));
  const pageSize = 25, pages = Math.max(1, Math.ceil(orders.length / pageSize));
  const page = Math.min(Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1, pages);
  return { flowKey, name, days, since: since.toISOString(), generatedAt: now.toISOString(), attribution, totals, steps,
    orders: orders.slice((page - 1) * pageSize, page * pageSize), ordersPage: { page, pageSize, total: orders.length, pages }, evidence,
    activity: recent.map(({ sortAt: _sortAt, ...message }) => { void _sortAt; return message; }),
    reasons: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([reason, count]) => ({ reason, count })),
  };
}

export type FlowReport = Awaited<ReturnType<typeof flowReport>>;
