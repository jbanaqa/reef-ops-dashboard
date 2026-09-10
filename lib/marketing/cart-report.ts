import { prisma } from "@/lib/prisma";
import { shop } from "./store";
import { DAY } from "./rules";
const names: Record<string, string> = {
  sms: "Text message",
  first: "Email #1 · Soft push",
  "final-yes": "Email #2 · Another soft push",
  "final-no": "Email #2 · Discount offer",
  final: "Follow-up · awaiting decision",
};
export async function cartReport() {
  const since = new Date(Date.now() - 30 * DAY);
  const rows = Object.entries(names).map(([key, label]) => ({
    key,
    label,
    waiting: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    orders: 0,
    revenue: {} as Record<string, number>,
    stopped: 0,
    needsAttention: 0,
  }));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const reasons = new Map<string, number>();
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.marketingMessage.findMany({
      where: {
        shop: shop(),
        flowKey: "abandoned-cart",
        createdAt: { gte: since },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 500,
      select: { id: true, status: true, error: true, flowCondition: true },
    });
    const rowFor = new Map<string, (typeof rows)[number]>();
    for (const m of page) {
      const row = byKey.get(m.flowCondition?.replace("cart-v1:", "") || "");
      if (!row) continue;
      rowFor.set(m.id, row);
      if (m.status === "SENT") row.sent++;
      else if (["PENDING", "SENDING"].includes(m.status)) row.waiting++;
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
            type: { in: ["DELIVERED", "OPENED", "CLICKED", "ORDER"] },
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
          if (e.type === "ORDER") {
            const p = e.payload as { currency?: string; revenue?: string };
            r.orders++;
            const amount = Number(p.revenue);
            if (p.currency && Number.isFinite(amount))
              r.revenue[p.currency] = (r.revenue[p.currency] || 0) + amount;
          } else if (!seen.has(k)) {
            seen.add(k);
            if (e.type === "DELIVERED") r.delivered++;
            if (e.type === "OPENED") r.opened++;
            if (e.type === "CLICKED") r.clicked++;
          }
        }
        if (events.length < 1000) break;
        ecursor = events[events.length - 1].id;
      }
    }
    if (page.length < 500) break;
    cursor = page[page.length - 1].id;
  }
  return {
    since: since.toISOString(),
    rows,
    reasons: [...reasons]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([reason, count]) => ({ reason, count })),
  };
}
