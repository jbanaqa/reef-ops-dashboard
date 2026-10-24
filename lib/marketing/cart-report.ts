import { prisma } from "@/lib/prisma";
import { shop } from "./store";
import { DAY } from "./rules";
import { attributionConfiguration, attributedOrders } from "./attribution";
import { customerCartMessages } from "./cart-report-scope";
import { addOrderRevenue, orderValue } from "./order-evidence";
const names: Record<string, string> = {
  sms: "Text message",
  first: "Email #1 · Soft push",
  "final-yes": "Email #2 · Another soft push",
  "final-no": "Email #2 · Discount offer",
  final: "Follow-up · awaiting decision",
};
export async function cartReport() {
  const since = new Date(Date.now() - 30 * DAY);
  const attribution = await attributionConfiguration(prisma);
  const rows = Object.entries(names).map(([key, label]) => ({
    key,
    label,
    waiting: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
    orders: 0,
    revenue: {} as Record<string, number>,
    stopped: 0,
    needsAttention: 0,
  }));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const reasons = new Map<string, number>();
  const rowFor = new Map<string, (typeof rows)[number]>();
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.marketingMessage.findMany({
      where: {
        shop: shop(),
        flowKey: "abandoned-cart",
        OR: [{ sentAt: { gte: since } }, { sentAt: null, createdAt: { gte: since } }],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 500,
      select: { id: true, key: true, flowKey: true, status: true, error: true, flowCondition: true, sentAt: true },
    });
    for (const m of await customerCartMessages(prisma, shop(), page)) {
      const row = byKey.get(m.flowCondition?.replace("cart-v1:", "") || "");
      if (!row) continue;
      rowFor.set(m.id, row);
      if (m.sentAt) row.sent++;
      if (["PENDING", "SENDING"].includes(m.status)) row.waiting++;
      else if (m.status === "CANCELLED") row.stopped++;
      else if (["FAILED", "UNKNOWN"].includes(m.status)) row.needsAttention++;
      if (m.error && m.status !== "SENT")
        reasons.set(m.error, (reasons.get(m.error) || 0) + 1);
    }
    if (page.length) {
      let ecursor: string | undefined;
      const seen = new Set<string>();
      for (;;) {
        const events = await prisma.marketingEvent.findMany({
          where: {
            shop: shop(),
            messageId: { in: page.map((m) => m.id) },
            type: { in: ["DELIVERED", "OPENED", "CLICKED", "BOUNCED", "COMPLAINED"] },
            ...(ecursor ? { id: { gt: ecursor } } : {}),
          },
          orderBy: { id: "asc" },
          take: 1000,
          select: { id: true, type: true, messageId: true, payload: true },
        });
        for (const e of events) {
          const r = rowFor.get(e.messageId!);
          if (!r) continue;
          const k = e.messageId + ":" + e.type;
          if (!seen.has(k)) {
            seen.add(k);
            if (e.type === "DELIVERED") r.delivered++;
            if (e.type === "OPENED") r.opened++;
            if (e.type === "CLICKED") r.clicked++;
            if (e.type === "BOUNCED") r.bounced++;
            if (e.type === "COMPLAINED") r.complained++;
          }
        }
        if (events.length < 1000) break;
        ecursor = events[events.length - 1].id;
      }
    }
    if (page.length < 500) break;
    cursor = page[page.length - 1].id;
  }
  const orders: { id: string; label: string; url: string | null; email: string; at: string; step: string;
    currency: string; amount: number | null; interaction: string; interactedAt: string }[] = [];
  const unverifiedOrderIds = new Set<string>();
  const staleOrderIds = new Set<string>();
  for await (const { order, match } of attributedOrders(prisma, { since, flowKey: "abandoned-cart", configuration: attribution, unverifiedOrderIds, staleOrderIds })) {
    const row = match ? rowFor.get(match.messageId) : undefined;
    if (!row || !match) continue;
    const p = order.payload as { currency?: string; revenue?: string; orderId?: string; orderLabel?: string };
    row.orders++;
    const { amount, currency } = orderValue(p);
    addOrderRevenue(row.revenue, p);
    const id = String(p.orderId || "").replace(/^gid:\/\/shopify\/Order\//, "");
    orders.push({ id: order.id, label: p.orderLabel || (id ? "Order " + id : "Order"),
      url: /^\d+$/.test(id) ? `https://${shop()}/admin/orders/${id}` : null,
      email: "", at: order.occurredAt.toISOString(), step: row.label, currency: currency || "", amount,
      interaction: match.interaction === "CLICKED" ? "Click" : "Open", interactedAt: match.interactedAt.toISOString() });
    orders.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
    if (orders.length > 25) orders.pop();
  }
  // Only the latest 25 orders need profile details; no raw checkout data or email artwork is returned.
  for (const item of orders) {
    const order = await prisma.marketingEvent.findFirst({ where: { id: item.id, shop: shop() }, select: { profile: { select: { email: true } } } });
    item.email = order?.profile?.email || "Email unavailable";
  }
  const activity = [];
  let activityCursor: string | undefined;
  while (activity.length < 25) {
    const page = await prisma.marketingMessage.findMany({
      where: { shop: shop(), flowKey: "abandoned-cart", OR: [{ createdAt: { gte: since } }, { sentAt: { gte: since } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
      ...(activityCursor ? { cursor: { id: activityCursor }, skip: 1 } : {}),
      select: { id: true, key: true, flowKey: true, flowCondition: true, subject: true, status: true, triggerAt: true, dueAt: true,
        sentAt: true, error: true, profile: { select: { id: true, email: true } } },
    });
    activity.push(...await customerCartMessages(prisma, shop(), page));
    if (page.length < 100) break;
    activityCursor = page[page.length - 1].id;
  }
  return {
    since: since.toISOString(),
    attribution,
    paymentVerification: { unverifiedOrders: unverifiedOrderIds.size, staleOrders: staleOrderIds.size },
    orders,
    activity: activity.slice(0, 25).map(({ profile, key: _key, flowKey: _flow, ...m }) => {
      void _key; void _flow;
      return { ...m, email: profile.email || "Email unavailable", profileId: profile.id };
    }),
    rows,
    reasons: [...reasons]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([reason, count]) => ({ reason, count })),
  };
}
export type CartReport = Awaited<ReturnType<typeof cartReport>>;
