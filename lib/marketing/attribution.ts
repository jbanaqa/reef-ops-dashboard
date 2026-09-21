import { DAY, marketingSettings } from "./rules";
import { shop, type Tx } from "./store";

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
  const messages = await client.marketingMessage.findMany({
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
      OR: [{ flowKey: { not: null } }, { campaignId: { not: null } }],
    },
    select: { id: true, sentAt: true },
  });
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
