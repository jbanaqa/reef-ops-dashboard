import { prisma } from "@/lib/prisma";
import { Content, eligible } from "./rules";
import { json, shop, Tx } from "./store";
export type FlowConfig = { reviewed: boolean; description?: string; steps: { minutes: number; subject: string; channel: string; content: Content }[]; smsContent?: Content; orderBranch?: { yes: { subject: string; content: Content }; no: { subject: string; content: Content } }; internalProfileIds?: string[]; threshold?: number };
export async function enroll(tx: Tx, key: string, profileId: string, eventKey: string, at: Date, context: { url?: string; expectedDeliveryAt?: Date; stockText?: string } = {}) {
  const resource = await tx.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "FLOW", key } } });
  if (!resource?.enabled) return;
  const config = resource.data as unknown as FlowConfig;
  if (!config.reviewed) return;
  if (key === "delivery-upsell" && !context.expectedDeliveryAt) return;
  const once = ["welcome", "b2b-welcome"].includes(key);
  const base = once ? `${key}:${profileId}` : `${key}:${profileId}:${eventKey}`;
  if (key === "abandoned-cart" && await tx.marketingMessage.findFirst({ where: { profileId, flowKey: key, triggerAt: { gte: new Date(+at - 86400000) }, status: { in: ["PENDING", "SENDING", "SENT"] } } })) return;
  // The audited abandoned-cart flow has one pre-branch email, then a single
  // conditional Email #2. Do not retain the former generic second email when
  // the explicit order branch is configured.
  const steps = key === "abandoned-cart" && config.orderBranch ? config.steps.slice(0, 1) : [...config.steps];
  if (key === "abandoned-cart" && config.smsContent) {
    const c = await tx.marketingConsent.findUnique({ where: { profileId_channel: { profileId, channel: "SMS_MARKETING" } } });
    if (eligible(c)) steps.push({ minutes: 30, subject: "Your cart", channel: "SMS_MARKETING", content: config.smsContent });
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const c = { ...step.content, ...(context.url ? { url: context.url } : {}) };
    if (context.stockText) c.body = context.stockText;
    if (key === "welcome" && i === 0) {
      if (!process.env.MARKETING_WELCOME_COUPON) continue;
      c.body += `\nYour first-order 10% discount code: ${process.env.MARKETING_WELCOME_COUPON}`;
    }
    const dueAt = key === "delivery-upsell" ? new Date(+context.expectedDeliveryAt! - 86400000) : new Date(+at + step.minutes * 60000);
    if (key === "delivery-upsell" && dueAt < new Date()) continue;
    const messageKey = `${base}:${i}`;
    const existing = await tx.marketingMessage.findUnique({ where: { key: messageKey }, select: { id: true, status: true, error: true } });
    if (existing?.status === "CANCELLED" && existing.error === "Not eligible for this channel") {
      await tx.marketingMessage.update({ where: { id: existing.id }, data: { status: "PENDING", channel: step.channel, subject: step.subject, content: json(c), dueAt, triggerAt: at, attemptedAt: null, sentAt: null, attempts: 0, providerId: null, error: null } });
    } else {
      await tx.marketingMessage.upsert({ where: { key: messageKey }, create: { shop: shop(), key: messageKey, profileId, flowKey: key, flowStep: i, channel: step.channel, subject: step.subject, content: json(c), dueAt, triggerAt: at }, update: {} });
    }
  }
  if (key === "abandoned-cart" && config.orderBranch) {
    const dueAt = new Date(+at + 1440 * 60000);
    await tx.marketingMessage.upsert({ where: { key: `${base}:order-branch` }, create: { shop: shop(), key: `${base}:order-branch`, profileId, flowKey: key, flowStep: 2, flowCondition: "ORDER_PLACED", channel: "EMAIL", subject: config.orderBranch.no.subject, content: json(config.orderBranch.no.content), dueAt, triggerAt: at }, update: {} });
  }
}
export async function lowStock() {
  const resource = await prisma.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "low-stock" } } });
  if (!resource?.enabled) return;
  const config = resource.data as unknown as FlowConfig;
  if (!config.reviewed || !config.internalProfileIds?.length) return;
  const states = await prisma.productInventoryState.findMany({ where: { shop: shop() } });
  for (const state of states) {
    const key = `stock:${state.productId}`;
    await prisma.$transaction(async tx => {
      const previous = await tx.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "STOCK", key } } });
      const low = state.totalAvailable <= (config.threshold ?? 5);
      if (low && previous && !(previous.data as { low: boolean }).low) {
        for (const profileId of config.internalProfileIds!) {
          const profile = await tx.marketingProfile.findFirst({ where: { id: profileId, shop: shop() } });
          if (profile) await enroll(tx, "low-stock", profileId, `${state.productId}:${state.checkedAt.toISOString()}`, new Date(), { stockText: `Low stock: ${state.productTitle || state.productId} has ${state.totalAvailable} units available.`, url: "https://coralsanonymous.com" });
        }
      }
      await tx.marketingResource.upsert({ where: { shop_kind_key: { shop: shop(), kind: "STOCK", key } }, create: { shop: shop(), kind: "STOCK", key, name: state.productTitle || key, data: { low } }, update: { data: { low } } });
    });
  }
}
