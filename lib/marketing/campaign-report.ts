import { prisma } from "@/lib/prisma";
import { shop } from "./store";

export async function campaignReport(id: string) {
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
      select: { id: true, status: true, error: true },
    });
    totals.messages += page.length;
    for (const message of page) {
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
          type: { in: ["DELIVERED", "OPENED", "CLICKED", "ORDER"] },
        },
        select: { type: true, messageId: true, payload: true },
      });
      const seen = new Set<string>();
      for (const event of events) {
        const key = `${event.messageId}:${event.type}`;
        if (event.type === "ORDER") {
          totals.ordered++;
          const payload = event.payload as {
            currency?: string;
            revenue?: string | number;
          };
          const amount = Number(payload.revenue);
          if (payload.currency && Number.isFinite(amount))
            totals.revenue[payload.currency] =
              (totals.revenue[payload.currency] || 0) + amount;
        } else if (!seen.has(key)) {
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
  return {
    campaign,
    totals,
    reasons: [...reasons]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count })),
  };
}
