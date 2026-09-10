import { enrollCart, CartLine } from "./cart";
import { content, DAY, withCoupon } from "./rules";
import { flowSequence, validateFlow } from "./flow-config";
export type { FlowConfig } from "./flow-config";
import { json, shop, Tx } from "./store";
export async function enroll(
  tx: Tx,
  key: string,
  profileId: string,
  eventKey: string,
  at: Date,
  context: {
    url?: string;
    expectedDeliveryAt?: Date;
    stockText?: string;
    lines?: CartLine[];
    observedAt?: Date;
  } = {},
) {
  const resource = await tx.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "FLOW", key } },
  });
  if (!resource?.enabled) return;
  const config = validateFlow(key, resource.data);
  if (!config.reviewed) return;
  if (key === "delivery-upsell" && !context.expectedDeliveryAt) return;
  if (key === "abandoned-cart" && at < new Date(Date.now() - 3 * DAY)) {
    if (!config.cart) return;
    const p = await tx.marketingProfile.findUnique({
      where: { id: profileId },
      select: { email: true },
    });
    const recent = await tx.marketingEvent.findFirst({
      where: {
        shop: shop(),
        type: { in: ["CHECKOUT_STARTED_TRUSTED", "HISTORY_CHECKOUT"] },
        occurredAt: { gte: new Date(Date.now() - 3 * DAY), lte: new Date() },
        OR: [
          { profileId },
          ...(p?.email
            ? [{ payload: { path: ["email"], equals: p.email } }]
            : []),
        ],
      },
    });
    if (!recent) return;
  }
  if (key === "abandoned-cart" && config.cart) {
    if (!context.url || !eventKey || eventKey === "undefined") return;
    await enrollCart(
      tx,
      profileId,
      eventKey,
      at,
      config,
      context.url,
      context.lines,
      context.observedAt,
    );
    return;
  }
  const once = ["welcome", "b2b-welcome"].includes(key);
  const base = once ? `${key}:${profileId}` : `${key}:${profileId}:${eventKey}`;
  if (
    key === "abandoned-cart" &&
    (await tx.marketingMessage.findFirst({
      where: {
        profileId,
        flowKey: key,
        triggerAt: { gte: new Date(+at - 86400000) },
        status: { in: ["PENDING", "SENDING", "SENT"] },
      },
    }))
  )
    return;
  const steps = flowSequence(key, config);
  for (const step of steps) {
    let c = content({
      ...step.content,
      ...(context.url ? { url: context.url } : {}),
    });
    if (context.stockText)
      c = { ...c, body: context.stockText, bodyHtml: undefined };
    if (key === "welcome" && step.id === "0") {
      if (!process.env.MARKETING_WELCOME_COUPON) continue;
      c = withCoupon(c, process.env.MARKETING_WELCOME_COUPON);
    }
    const dueAt =
      key === "delivery-upsell"
        ? new Date(+context.expectedDeliveryAt! - DAY)
        : new Date(+at + step.minutes * 60000);
    if (key === "delivery-upsell" && dueAt < new Date()) continue;
    const messageKey = base + ":" + step.id;
    const data = {
      channel: step.channel,
      subject: step.subject,
      content: json(c),
      dueAt,
      triggerAt: at,
    };
    const existing = await tx.marketingMessage.findUnique({
      where: { key: messageKey },
      select: { id: true, status: true, error: true },
    });
    if (
      existing?.status === "CANCELLED" &&
      ["Not eligible for this channel", "B2B tag removed"].includes(
        existing.error || "",
      )
    ) {
      await tx.marketingMessage.update({
        where: { id: existing.id },
        data: {
          ...data,
          status: "PENDING",
          attemptedAt: null,
          sentAt: null,
          attempts: 0,
          providerId: null,
          error: null,
        },
      });
    } else {
      await tx.marketingMessage.upsert({
        where: { key: messageKey },
        create: {
          shop: shop(),
          key: messageKey,
          profileId,
          flowKey: key,
          flowStep: step.target.index ?? null,
          ...data,
        },
        update: {},
      });
    }
  }
}
