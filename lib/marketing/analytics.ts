import { prisma } from "@/lib/prisma";
import { DAY } from "./rules";
import { shop } from "./store";
import {
  attributionConfiguration,
  findEmailAttribution,
} from "./attribution";

const periods = new Set([7, 30, 90, 365]);

type Row = {
  key: string;
  kind: "FLOW" | "CAMPAIGN";
  name: string;
  messages: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  orders: number;
  revenue: Record<string, number>;
};

const emptyRow = (key: string, kind: Row["kind"], name: string): Row => ({
  key,
  kind,
  name,
  messages: 0,
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  orders: 0,
  revenue: {},
});

function money(target: Record<string, number>, payload: unknown) {
  const value = payload as { currency?: string; revenue?: string | number };
  const amount = Number(value.revenue);
  if (value.currency && Number.isFinite(amount))
    target[value.currency] = (target[value.currency] || 0) + amount;
}

export async function marketingAnalytics(requestedDays = 30) {
  const days = periods.has(requestedDays) ? requestedDays : 30;
  const since = new Date(Date.now() - days * DAY);
  const attribution = await attributionConfiguration(prisma);
  const flows = await prisma.marketingResource.findMany({
    where: { shop: shop(), kind: "FLOW" },
    select: { key: true, name: true },
  });
  const rows = new Map(
    flows.map((flow) => [
      `FLOW:${flow.key}`,
      emptyRow(flow.key, "FLOW", flow.name),
    ]),
  );

  const messages = new Map<
    string,
    {
      id: string;
      flowKey: string | null;
      campaignId: string | null;
      campaign: { name: string } | null;
    }
  >();
  const engagementEvents: { messageId: string | null; type: string }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.marketingMessage.findMany({
      where: {
        shop: shop(),
        sentAt: { gte: since },
        OR: [{ flowKey: { not: null } }, { campaignId: { not: null } }],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 500,
      select: {
        id: true,
        flowKey: true,
        campaignId: true,
        campaign: { select: { name: true } },
      },
    });
    for (const message of page) messages.set(message.id, message);
    if (page.length)
      engagementEvents.push(
        ...(await prisma.marketingEvent.findMany({
          where: {
            shop: shop(),
            type: { in: ["DELIVERED", "OPENED", "CLICKED"] },
            messageId: { in: page.map((message) => message.id) },
          },
          distinct: ["messageId", "type"],
          select: { messageId: true, type: true },
        })),
      );
    if (page.length < 500) break;
    cursor = page[page.length - 1].id;
  }

  const orderEvents = await prisma.marketingEvent.findMany({
    where: { shop: shop(), type: "ORDER", occurredAt: { gte: since } },
    orderBy: { occurredAt: "asc" },
    select: { profileId: true, occurredAt: true, payload: true },
  });

  const rowFor = new Map<string, Row>();
  for (const message of messages.values()) {
    const kind = message.campaignId ? "CAMPAIGN" : "FLOW";
    const key = message.campaignId || message.flowKey!;
    const mapKey = `${kind}:${key}`;
    const row =
      rows.get(mapKey) ||
      emptyRow(
        key,
        kind,
        message.campaign?.name ||
          flows.find((flow) => flow.key === message.flowKey)?.name ||
          "Automation",
      );
    rows.set(mapKey, row);
    row.messages++;
    rowFor.set(message.id, row);
  }
  for (const message of messages.values()) rowFor.get(message.id)!.sent++;
  for (const event of engagementEvents) {
    const row = event.messageId ? rowFor.get(event.messageId) : undefined;
    if (!row) continue;
    if (event.type === "DELIVERED") row.delivered++;
    if (event.type === "OPENED") row.opened++;
    if (event.type === "CLICKED") row.clicked++;
  }

  const storeRevenue: Record<string, number> = {};
  const attributedRevenue: Record<string, number> = {};
  for (let index = 0; index < orderEvents.length; index += 20) {
    const batch = orderEvents.slice(index, index + 20);
    const matches = await Promise.all(
      batch.map((order) =>
        order.profileId
          ? findEmailAttribution(
              prisma,
              order.profileId,
              order.occurredAt,
              attribution,
            )
          : null,
      ),
    );
    for (let offset = 0; offset < batch.length; offset++) {
      const order = batch[offset];
      const match = matches[offset];
      money(storeRevenue, order.payload);
      const row = match ? rowFor.get(match.messageId) : undefined;
      if (row) {
        row.orders++;
        money(row.revenue, order.payload);
        money(attributedRevenue, order.payload);
      }
    }
  }
  const reportRows = [...rows.values()].sort(
    (a, b) =>
      b.orders - a.orders ||
      Object.values(b.revenue).reduce((sum, value) => sum + value, 0) -
        Object.values(a.revenue).reduce((sum, value) => sum + value, 0) ||
      a.name.localeCompare(b.name),
  );
  return {
    days,
    since: since.toISOString(),
    attribution,
    totals: {
      messages: reportRows.reduce((sum, row) => sum + row.messages, 0),
      sent: reportRows.reduce((sum, row) => sum + row.sent, 0),
      delivered: reportRows.reduce((sum, row) => sum + row.delivered, 0),
      opened: reportRows.reduce((sum, row) => sum + row.opened, 0),
      clicked: reportRows.reduce((sum, row) => sum + row.clicked, 0),
      orders: reportRows.reduce((sum, row) => sum + row.orders, 0),
      trackedOrders: orderEvents.length,
      revenue: attributedRevenue,
      storeRevenue,
    },
    rows: reportRows,
  };
}
