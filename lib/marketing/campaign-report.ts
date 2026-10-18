import { prisma } from "@/lib/prisma";
import { shop } from "./store";
import { attributedOrders, attributionConfiguration } from "./attribution";
import { Prisma } from "@/app/generated/prisma/client";

export async function campaignReport(id: string, requestedPage = 1) {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1)
    throw new Error("Invalid orders page.");
  const campaign = await prisma.marketingCampaign.findFirst({
    where: { id, shop: shop() },
    select: { id: true, name: true, status: true, scheduledAt: true },
  });
  if (!campaign) throw new Error("Campaign not found.");
  const totals = {
    messages: 0,
    queued: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    ordered: 0,
    skipped: 0,
    failed: 0,
    needsAttention: 0,
    revenue: {} as Record<string, number>,
  };
  const reasons = new Map<string, number>();
  const sentMessageIds = new Set<string>();
  const orders: { id: string; orderId: string | null; label: string | null; profileId: string | null; placedAt: Date; amount: number | null; currency: string | null; interaction: "CLICKED" | "OPENED"; interactedAt: Date }[] = [];
  let firstSentAt: Date | undefined;
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.marketingMessage.findMany({
      where: {
        shop: shop(),
        campaignId: id,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 500,
      select: { id: true, status: true, error: true, sentAt: true },
    });
    totals.messages += page.length;
    for (const message of page) {
      if (message.sentAt) {
        sentMessageIds.add(message.id);
        if (!firstSentAt || message.sentAt < firstSentAt) firstSentAt = message.sentAt;
      }
      if (["PENDING", "SENDING"].includes(message.status)) totals.queued++;
      if (message.status === "SENT") totals.sent++;
      if (message.status === "CANCELLED") totals.skipped++;
      if (message.status === "FAILED") totals.failed++;
      if (message.status === "UNKNOWN") totals.needsAttention++;
      if (message.error && message.status !== "SENT")
        reasons.set(message.error, (reasons.get(message.error) || 0) + 1);
    }
    if (page.length) {
      const messageIds = page.map((message) => message.id);
      const events = await prisma.marketingEvent.findMany({
        where: {
          shop: shop(),
          messageId: { in: messageIds },
          type: { in: ["DELIVERED", "OPENED", "CLICKED"] },
        },
        select: { type: true, messageId: true, payload: true },
      });
      const seen = new Set<string>();
      for (const event of events) {
        const key = `${event.messageId}:${event.type}`;
        if (!seen.has(key)) {
          seen.add(key);
          if (event.type === "DELIVERED") totals.delivered++;
          if (event.type === "OPENED") totals.opened++;
          if (event.type === "CLICKED") totals.clicked++;
        }
      }
    }
    if (page.length < 500) break;
    cursor = page[page.length - 1].id;
  }
  if (firstSentAt) {
    const configuration = await attributionConfiguration(prisma);
    for await (const { order, match } of attributedOrders(prisma, {
      since: firstSentAt, campaignId: id, configuration,
    })) {
      if (!match || !sentMessageIds.has(match.messageId)) continue;
      totals.ordered++;
      const payload = order.payload as { currency?: string; revenue?: string | number; orderId?: string; orderLabel?: string };
      const amount = Number(payload.revenue);
      if (payload.currency && Number.isFinite(amount))
        totals.revenue[payload.currency] = (totals.revenue[payload.currency] || 0) + amount;
      const orderId = String(payload.orderId || "").replace(/^gid:\/\/shopify\/Order\//, "");
      orders.push({ id: order.id, orderId: /^\d+$/.test(orderId) ? orderId : null,
        label: payload.orderLabel || null, profileId: order.profileId, placedAt: order.occurredAt,
        amount: payload.revenue != null && Number.isFinite(amount) ? amount : null,
        currency: payload.currency || null, interaction: match.interaction, interactedAt: match.interactedAt });
    }
  }
  orders.sort((a, b) => +b.placedAt - +a.placedAt || b.id.localeCompare(a.id));
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(orders.length / pageSize));
  const page = Math.min(requestedPage, pages);
  const visible = orders.slice((page - 1) * pageSize, page * pageSize);
  const profileIds = [...new Set(visible.flatMap(order => order.profileId ? [order.profileId] : []))];
  const profiles = profileIds.length ? await prisma.marketingProfile.findMany({
    where: { shop: shop(), id: { in: profileIds } }, select: { id: true, name: true, email: true },
  }) : [];
  // Historical ORDER summaries didn't save the human-readable order number.
  // Read only that label from existing Shopify events, without copying order bodies.
  const missingLabels = visible.flatMap(order => !order.label && order.orderId ? [order.orderId] : []);
  const labels = missingLabels.length ? await prisma.$queryRaw<{ orderId: string; label: string | null }[]>(Prisma.sql`
    SELECT "payload"->>'id' AS "orderId", COALESCE(NULLIF("payload"->>'name', ''), NULLIF("payload"->>'order_number', '')) AS label
    FROM "MarketingEvent" WHERE "shop" = ${shop()} AND "type" IN ('orders/create', 'orders/updated')
      AND "payload"->>'id' IN (${Prisma.join(missingLabels)}) ORDER BY "createdAt" DESC
  `) : [];
  return {
    campaign,
    totals,
    orders: visible.map(({ profileId, ...order }) => ({ ...order,
      label: order.label || labels.find(label => label.orderId === order.orderId && label.label)?.label || (order.orderId ? `Order ${order.orderId}` : "Order number unavailable"),
      customer: profiles.find(profile => profile.id === profileId) || null,
      shopifyUrl: order.orderId ? `https://${shop()}/admin/orders/${order.orderId}` : null,
    })),
    ordersPage: { page, pageSize, total: orders.length, pages },
    reasons: [...reasons]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count })),
  };
}
