import { prisma } from "@/lib/prisma";
import { DAY } from "./rules";
import { shop } from "./store";
import { customerCartMessages } from "./cart-report-scope";
import { addOrderRevenue } from "./order-evidence";
import {
  attributionConfiguration,
  attributedOrders,
} from "./attribution";

const periods = new Set([7, 30, 90, 365]);

type Row = {
  key: string;
  kind: "FLOW" | "CAMPAIGN";
  name: string;
  messages: number;
  sent: number;
  recipients: number;
  delivered: number;
  opened: number;
  clicked: number;
  orders: number;
  convertedRecipients: number;
  revenue: Record<string, number>;
};

const emptyRow = (key: string, kind: Row["kind"], name: string): Row => ({
  key,
  kind,
  name,
  messages: 0,
  sent: 0,
  recipients: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  orders: 0,
  convertedRecipients: 0,
  revenue: {},
});

export async function marketingAnalytics(requestedDays = 30) {
  const days = periods.has(requestedDays) ? requestedDays : 30;
  const now = new Date(), since = new Date(+now - days * DAY);
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
      profileId: string;
      sentAt: Date | null;
      flowKey: string | null;
      campaignId: string | null;
      campaign: { name: string } | null;
    }
  >();
  const engagementEvents: { messageId: string | null; type: string; occurredAt: Date }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.marketingMessage.findMany({
      where: {
        shop: shop(),
        channel: "EMAIL",
        sentAt: { gte: since, lte: now },
        OR: [
          { flowKey: { not: null } },
          { campaign: { is: { testOfCampaignId: null } } },
        ],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 500,
      select: {
        id: true,
        profileId: true,
        sentAt: true,
        key: true,
        flowKey: true,
        campaignId: true,
        campaign: { select: { name: true } },
      },
    });
    for (const message of await customerCartMessages(prisma, shop(), page)) messages.set(message.id, message);
    if (page.length)
      engagementEvents.push(
        ...(await prisma.marketingEvent.findMany({
          where: {
            shop: shop(),
            type: { in: ["DELIVERED", "OPENED", "CLICKED"] },
            messageId: { in: page.map((message) => message.id) },
            occurredAt: { lte: now },
          },
          distinct: ["messageId", "type"],
          orderBy: { occurredAt: "desc" },
          select: { messageId: true, type: true, occurredAt: true },
        })),
      );
    if (page.length < 500) break;
    cursor = page[page.length - 1].id;
  }

  const rowFor = new Map<string, Row>();
  const recipients = new Map<Row, Set<string>>(), buyers = new Map<Row, Set<string>>();
  const allRecipients = new Set<string>(), allBuyers = new Set<string>();
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
    if (!recipients.has(row)) { recipients.set(row, new Set()); buyers.set(row, new Set()); }
    recipients.get(row)!.add(message.profileId); allRecipients.add(message.profileId);
    rowFor.set(message.id, row);
  }
  for (const message of messages.values()) rowFor.get(message.id)!.sent++;
  for (const event of engagementEvents) {
    const row = event.messageId ? rowFor.get(event.messageId) : undefined;
    const message = event.messageId ? messages.get(event.messageId) : undefined;
    if (!row || !message?.sentAt || event.occurredAt < message.sentAt) continue;
    if (event.type === "DELIVERED") row.delivered++;
    if (event.type === "OPENED") row.opened++;
    if (event.type === "CLICKED") row.clicked++;
  }

  const storeRevenue: Record<string, number> = {};
  const attributedRevenue: Record<string, number> = {};
  let trackedOrders = 0;
  const unverifiedOrderIds = new Set<string>();
  for await (const { order, match } of attributedOrders(prisma, {
    since, until: now, configuration: attribution, unverifiedOrderIds,
  })) {
    trackedOrders++;
    if ((order.payload as { test?: boolean }).test !== true) addOrderRevenue(storeRevenue, order.payload);
    const row = match ? rowFor.get(match.messageId) : undefined;
    if (row) {
      row.orders++;
      if (order.profileId) { buyers.get(row)!.add(order.profileId); allBuyers.add(order.profileId); }
      addOrderRevenue(row.revenue, order.payload);
      addOrderRevenue(attributedRevenue, order.payload);
    }
  }
  for (const row of rows.values()) {
    row.recipients = recipients.get(row)?.size || 0;
    row.convertedRecipients = buyers.get(row)?.size || 0;
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
    paymentVerification: { unverifiedOrders: unverifiedOrderIds.size },
    totals: {
      messages: reportRows.reduce((sum, row) => sum + row.messages, 0),
      sent: reportRows.reduce((sum, row) => sum + row.sent, 0),
      recipients: allRecipients.size,
      convertedRecipients: allBuyers.size,
      delivered: reportRows.reduce((sum, row) => sum + row.delivered, 0),
      opened: reportRows.reduce((sum, row) => sum + row.opened, 0),
      clicked: reportRows.reduce((sum, row) => sum + row.clicked, 0),
      orders: reportRows.reduce((sum, row) => sum + row.orders, 0),
      trackedOrders,
      revenue: attributedRevenue,
      storeRevenue,
    },
    rows: reportRows,
  };
}
