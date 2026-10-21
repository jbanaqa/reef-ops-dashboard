import { DAY, marketingSettings } from "./rules";
import { shop, type Tx } from "./store";
import { customerCartMessages } from "./cart-report-scope";
import { welcomeAttributionFacts, type WelcomeOrderPayload } from "./welcome-attribution";

type AttributionClient = Pick<
  Tx,
  "marketingEvent" | "marketingMessage" | "marketingResource" | "$queryRaw"
>;

export type AttributionMatch = {
  messageId: string;
  interaction: "CLICKED" | "OPENED" | "COUPON";
  interactedAt: Date;
  welcomeReason?: "FIRST_ORDER" | "WELCOME_CODE";
  discountCode?: string;
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
    flowKey?: string;
    until?: Date;
    configuration: Awaited<ReturnType<typeof attributionConfiguration>>;
  },
) {
  let cursor: string | undefined;
  const seenOrders = new Set<string>();
  for (;;) {
    const page = await client.marketingEvent.findMany({
      where: {
        shop: shop(),
        type: "ORDER",
        occurredAt: { gte: options.since, lte: options.until || new Date() },
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
        ...(options.flowKey ? { profile: { is: { messages: {
          some: { shop: shop(), flowKey: options.flowKey, sentAt: { not: null } },
        } } } } : {}),
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
          ? findEmailAttribution(client, order.profileId, order.occurredAt, options.configuration, order.payload as WelcomeOrderPayload)
          : null),
      );
      for (let offset = 0; offset < batch.length; offset++) {
        const id = String((batch[offset].payload as { orderId?: unknown }).orderId || "")
          .replace(/^gid:\/\/shopify\/Order\//, "");
        const identity = /^\d+$/.test(id) ? "order:" + id : "event:" + batch[offset].id;
        if (seenOrders.has(identity)) continue;
        seenOrders.add(identity);
        yield { order: batch[offset], match: matches[offset] };
      }
    }
    if (page.length < 500) break;
    cursor = page[page.length - 1].id;
  }
}

/** One winner: verified Welcome-code redemption, otherwise eligible email last touch. */
export async function findEmailAttribution(
  client: AttributionClient,
  profileId: string,
  convertedAt: Date,
  configuration?: {
    emailClickDays: number;
    emailOpenDays: number;
  },
  order?: WelcomeOrderPayload,
): Promise<AttributionMatch | null> {
  const settings = configuration || (await attributionConfiguration(client));
  const maxDays = Math.max(settings.emailClickDays, settings.emailOpenDays);
  const candidates = await client.marketingMessage.findMany({
    where: {
      shop: shop(),
      profileId,
      channel: "EMAIL",
      sentAt: { lte: convertedAt },
      AND: [{ OR: [
        { flowKey: { not: null } },
        { campaign: { is: { testOfCampaignId: null } } },
      ] }, { OR: [
        { flowKey: "welcome" },
        // Welcome code evidence can outlive an open window; other messages
        // retain the existing bounded engagement lookup.
        { sentAt: { gte: new Date(+convertedAt - (maxDays + 7) * DAY) } },
      ] }],
    },
    select: { id: true, key: true, flowKey: true, profileId: true, sentAt: true, flowStep: true, triggerAt: true },
  });
  const customerMessages = await customerCartMessages(client, shop(), candidates);
  const welcome = await welcomeAttributionFacts(client, profileId, convertedAt, customerMessages, order);
  if (welcome.couponMatch) return { messageId: welcome.couponMatch.messageId,
    interaction: "COUPON", interactedAt: convertedAt, welcomeReason: "WELCOME_CODE", discountCode: welcome.couponMatch.code };
  const messages = customerMessages.filter(message => message.flowKey !== "welcome" || welcome.eligibleMessageIds.has(message.id));
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
        ...(order && messages.find(message => message.id === event.messageId)?.flowKey === "welcome"
          ? { welcomeReason: "FIRST_ORDER" as const } : {}),
      };
  }
  return null;
}
