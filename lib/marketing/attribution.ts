import { DAY, marketingSettings } from "./rules";
import { shop, type Tx } from "./store";
import { customerCartMessages } from "./cart-report-scope";

type AttributionClient = Pick<
  Tx,
  "marketingEvent" | "marketingMessage" | "marketingResource"
>;

export type AttributionMatch = {
  messageId: string;
  interaction: "CLICKED" | "OPENED";
  interactedAt: Date;
};

export async function attributionConfiguration(client: AttributionClient) {
  const row = await client.marketingResource.findUnique({
    where: {
      shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" },
    },
    select: { data: true },
  });
  return marketingSettings(row?.data).attribution;
}

/** Resolve reports from current engagement/settings, never the saved ORDER messageId. */
export async function* attributedOrders(
  client: AttributionClient,
  options: {
    since: Date;
    campaignId?: string;
    configuration: Awaited<ReturnType<typeof attributionConfiguration>>;
  },
) {
  let cursor: string | undefined;
  for (;;) {
    const page = await client.marketingEvent.findMany({
      where: {
        shop: shop(),
        type: "ORDER",
        occurredAt: { gte: options.since },
        ...(options.campaignId
          ? {
              profile: {
                is: {
                  messages: {
                    some: { campaignId: options.campaignId, sentAt: { not: null } },
                  },
                },
              },
            }
          : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 500,
      select: { id: true, profileId: true, occurredAt: true, payload: true },
    });
    for (let index = 0; index < page.length; index += 20) {
      const batch = page.slice(index, index + 20);
      const matches = await Promise.all(
        batch.map((order) => order.profileId
          ? findEmailAttribution(client, order.profileId, order.occurredAt, options.configuration)
          : null),
      );
      for (let offset = 0; offset < batch.length; offset++)
        yield { order: batch[offset], match: matches[offset] };
    }
    if (page.length < 500) break;
    cursor = page[page.length - 1].id;
  }
}

/** Klaviyo-style email last touch: the latest qualifying open or click wins. */
export async function findEmailAttribution(
  client: AttributionClient,
  profileId: string,
  convertedAt: Date,
  configuration?: {
    emailClickDays: number;
    emailOpenDays: number;
  },
): Promise<AttributionMatch | null> {
  const settings = configuration || (await attributionConfiguration(client));
  const maxDays = Math.max(settings.emailClickDays, settings.emailOpenDays);
  const candidates = await client.marketingMessage.findMany({
    where: {
      shop: shop(),
      profileId,
      channel: "EMAIL",
      sentAt: {
        // Delivery normally follows immediately, while a short cushion keeps a
        // delayed provider delivery eligible without scanning all history.
        gte: new Date(+convertedAt - (maxDays + 7) * DAY),
        lte: convertedAt,
      },
      OR: [
        { flowKey: { not: null } },
        { campaign: { is: { testOfCampaignId: null } } },
      ],
    },
    select: { id: true, key: true, flowKey: true, sentAt: true },
  });
  const messages = await customerCartMessages(client, shop(), candidates);
  if (!messages.length) return null;
  const deliveryEvents = await client.marketingEvent.findMany({
    where: {
      shop: shop(),
      profileId,
      messageId: { in: messages.map((message) => message.id) },
      type: "DELIVERED",
      occurredAt: { lte: convertedAt },
    },
    orderBy: { occurredAt: "asc" },
    select: { messageId: true, occurredAt: true },
  });
  const deliveredAt = new Map<string, Date>();
  for (const event of deliveryEvents)
    if (event.messageId && !deliveredAt.has(event.messageId))
      deliveredAt.set(event.messageId, event.occurredAt);
  const receivedAt = new Map(
    messages.map((message) => [
      message.id,
      deliveredAt.get(message.id) || message.sentAt!,
    ]),
  );
  const events = await client.marketingEvent.findMany({
    where: {
      shop: shop(),
      profileId,
      messageId: { in: messages.map((message) => message.id) },
      type: { in: ["CLICKED", "OPENED"] },
      occurredAt: { lte: convertedAt },
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { messageId: true, type: true, occurredAt: true },
  });
  for (const event of events) {
    if (!event.messageId) continue;
    const messageReceivedAt = receivedAt.get(event.messageId);
    const window =
      event.type === "CLICKED"
        ? settings.emailClickDays
        : settings.emailOpenDays;
    if (
      messageReceivedAt &&
      event.occurredAt >= messageReceivedAt &&
      messageReceivedAt >= new Date(+convertedAt - window * DAY)
    )
      return {
        messageId: event.messageId,
        interaction: event.type as AttributionMatch["interaction"],
        interactedAt: event.occurredAt,
      };
  }
  return null;
}
