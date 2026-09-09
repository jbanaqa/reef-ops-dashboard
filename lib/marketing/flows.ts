import { prisma } from "@/lib/prisma";
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
  context: { url?: string; expectedDeliveryAt?: Date; stockText?: string } = {},
) {
  const resource = await tx.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "FLOW", key } },
  });
  if (!resource?.enabled) return;
  const config = validateFlow(key, resource.data);
  if (!config.reviewed) return;
  if (key === "delivery-upsell" && !context.expectedDeliveryAt) return;
  if (key === "abandoned-cart" && at < new Date(Date.now() - 3 * DAY)) return;
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

export async function lowStock() {
  const resource = await prisma.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "low-stock" } },
  });
  if (!resource?.enabled) return;
  const config = validateFlow("low-stock", resource.data);
  if (!config.reviewed || !config.internalProfileIds?.length) return;
  const states = await prisma.productInventoryState.findMany({
    where: { shop: shop() },
  });
  for (const state of states) {
    const key = `stock:${state.productId}`;
    await prisma.$transaction(async (tx) => {
      const previous = await tx.marketingResource.findUnique({
        where: { shop_kind_key: { shop: shop(), kind: "STOCK", key } },
      });
      const low = state.totalAvailable <= (config.threshold ?? 5);
      if (low && previous && !(previous.data as { low: boolean }).low) {
        for (const profileId of config.internalProfileIds!) {
          const profile = await tx.marketingProfile.findFirst({
            where: { id: profileId, shop: shop() },
          });
          if (profile)
            await enroll(
              tx,
              "low-stock",
              profileId,
              `${state.productId}:${state.checkedAt.toISOString()}`,
              new Date(),
              {
                stockText: `Low stock: ${state.productTitle || state.productId} has ${state.totalAvailable} units available.`,
                url: "https://coralsanonymous.com",
              },
            );
        }
      }
      await tx.marketingResource.upsert({
        where: { shop_kind_key: { shop: shop(), kind: "STOCK", key } },
        create: {
          shop: shop(),
          kind: "STOCK",
          key,
          name: state.productTitle || key,
          data: { low },
        },
        update: { data: { low } },
      });
    });
  }
}
