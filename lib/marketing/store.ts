import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getShopifyShopDomain } from "@/lib/shopify";
import { Prisma } from "@/app/generated/prisma/client";
import { Channel, DAY, defaultContent, email, flowDefaults, phone, Segment } from "./rules";

export const shop = () => getShopifyShopDomain();
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export type Tx = Prisma.TransactionClient;
export async function atomic<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let n = 0; ; n++) {
    try { return await prisma.$transaction(fn, { isolationLevel: "Serializable", timeout: 15000 }); }
    catch (e) { if (n < 3 && e instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(e.code)) continue; throw e; }
  }
}
export async function identify(tx: Tx, input: { email?: string; phone?: string; shopifyId?: string; name?: string }) {
  const identity = { email: input.email ? email(input.email) : undefined, phone: input.phone ? phone(input.phone) : undefined, shopifyId: input.shopifyId || undefined };
  const keys = Object.entries(identity).filter(([, v]) => v).map(([k, v]) => ({ [k]: v }));
  if (!keys.length) throw new Error("A verified customer identity is required.");
  const profiles = await tx.marketingProfile.findMany({ where: { shop: shop(), OR: keys } });
  if (profiles.length > 1) throw new Error("Identity conflict: reconcile profiles before retrying. No consent was transferred.");
  const existing = profiles[0];
  if (existing && Object.entries(identity).some(([k,v]) => v && existing[k as keyof typeof identity] && existing[k as keyof typeof identity] !== v)) throw new Error("Identity change requires review; consent cannot move to another address.");
  return existing ? tx.marketingProfile.update({ where: { id: existing.id }, data: { ...identity, ...(input.name ? { name: input.name } : {}) } }) : tx.marketingProfile.create({ data: { shop: shop(), ...identity, name: input.name || "" } });
}
export async function record(tx: Tx, input: { key: string; type: string; profileId?: string; anonymousId?: string; messageId?: string; payload?: unknown; occurredAt?: Date }) {
  return tx.marketingEvent.upsert({ where: { shop_key: { shop: shop(), key: input.key } }, create: { ...input, shop: shop(), payload: json(input.payload || {}), occurredAt: input.occurredAt || new Date() }, update: {} });
}
export async function consent(tx: Tx, profileId: string, channel: Channel, status: string, source: string, occurredAt: Date, reason?: string) {
  if (!["SUBSCRIBED", "UNSUBSCRIBED", "NEVER_SUBSCRIBED"].includes(status)) throw new Error("Invalid consent status.");
  const current = await tx.marketingConsent.findUnique({ where: { profileId_channel: { profileId, channel } } });
  const suppress = status === "UNSUBSCRIBED" || !!reason;
  await record(tx, { key: `consent:${profileId}:${channel}:${source}:${occurredAt.toISOString()}:${status}:${reason || ""}`, type: "CONSENT", profileId, occurredAt, payload: { channel, status, source, reason, ignored: !!current && current.occurredAt > occurredAt } });
  // Suppressions are sticky. Neither imports nor delayed customer updates can undo them.
  if (current && current.occurredAt > occurredAt && !suppress) return;
  const data = { status: current?.suppressed && !suppress ? current.status : status, suppressed: suppress || current?.suppressed || false, reason: reason || current?.reason, source, occurredAt: current && current.occurredAt > occurredAt ? current.occurredAt : occurredAt };
  await tx.marketingConsent.upsert({ where: { profileId_channel: { profileId, channel } }, create: { profileId, channel, ...data }, update: data });
  if (suppress) await tx.marketingMessage.updateMany({ where: { profileId, channel, status: "PENDING" }, data: { status: "CANCELLED", error: "Channel suppressed" } });
}
export function audienceWhere(audience: Segment, channel = "EMAIL", now = new Date()): Prisma.MarketingProfileWhereInput {
  return { shop: shop(), ...(channel === "EMAIL" ? { email: { not: null } } : { phone: { not: null } }), consents: { some: { channel, status: "SUBSCRIBED", suppressed: false } }, ...(audience.openedDays ? { lastOpenedAt: { gte: new Date(+now - audience.openedDays * DAY), lte: now } } : {}), ...(audience.tag ? { tags: { has: audience.tag } } : {}), ...(audience.list ? { lists: { has: audience.list } } : {}), ...(audience.purchasedDays ? { lastOrderAt: { gte: new Date(+now - audience.purchasedDays * DAY), lte: now } } : {}), ...(audience.excludePurchasedDays ? { OR: [{ lastOrderAt: null }, { lastOrderAt: { lt: new Date(+now - audience.excludePurchasedDays * DAY) } }] } : {}) };
}
const b2bContent = { heading: "Welcome to Corals Anonymous Wholesale!", body: ['Hi {{ first_name|default:"Friend!" }}!',"","We are thrilled to welcome you to the Corals Anonymous Wholesale family!","","Here is what you can look forward to as a Corals Anonymous Wholesale customer:","","- ROTATING SUPER SALES EVERY WEEK with new items added daily. Ensure to keep an eye out for our newest arrivals!","- WYSIWYG WEEKENDS, where selected WYSIWYG items are 50-80% OFF, every Friday at 7 AM PST.","- 10% OFF COUPON CODE for your first order by signing up for our newsletter located at our homepage left bottom corner.","","Get started by logging into your wholesale account. Click the button below to visit our homepage and sign in. Please reach out if you have any questions!","","Best regards,","Corals Anonymous Team"].join(String.fromCharCode(10)), button: "Sign In & Buy Now!", url: "https://coralsanonymous.com", preview: "Welcome to Corals Anonymous Wholesale!", template: "b2b-wholesale" };
export async function backfillB2BWelcome() { const b2b = await prisma.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "b2b-welcome" } } }); if (b2b) { const data = b2b.data as { steps?: { content?: { heading?: string; body?: string } }[] }; if (data.steps?.[0]?.content && (data.steps[0].content.heading === defaultContent.heading || data.steps[0].content.body?.includes("Rotating super sales every week"))) await prisma.marketingResource.update({ where: { id: b2b.id }, data: { data: { ...(b2b.data as object), steps: data.steps.map((step, index) => index === 0 ? { ...step, subject: "Welcome to Corals Anonymous Wholesale!", content: b2bContent } : step) } } }); } }
export async function ensureB2BTemplate() { const b2b = await prisma.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "b2b-welcome" } } }); if (b2b) { const data = b2b.data as { steps?: { content?: Record<string, unknown> }[] }; const current = data.steps?.[0]?.content; if (current && !current.template) await prisma.marketingResource.update({ where: { id: b2b.id }, data: { data: json({ ...(b2b.data as object), steps: data.steps!.map((step, index) => index === 0 ? { ...step, content: { ...current, template: "b2b-wholesale" } } : step) }) } }); } }
export async function seed() {
  for (const f of flowDefaults) await prisma.marketingResource.upsert({ where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: f.key } }, create: { shop: shop(), kind: "FLOW", key: f.key, name: f.name, data: json({ trigger: f.trigger, description: f.description, reviewed: false, steps: f.delays.map((delay, index) => ({ minutes: delay, subject: index === 0 && f.key === "abandoned-cart" ? "Soft cart reminder" : f.name, channel: f.key === "low-stock" ? "SMS_TRANSACTIONAL" : "EMAIL", content: f.key === "b2b-welcome" ? b2bContent : defaultContent })), ...(f.key === "abandoned-cart" ? { smsContent: { ...defaultContent, heading: "Still thinking it over?", body: "Your cart is waiting for you at Corals Anonymous.", button: "Complete your order" }, orderBranch: { yes: { subject: "Another Soft Push", content: { ...defaultContent, heading: "Your corals are still waiting", body: "Your order is not complete yet, but your cart is still saved.", button: "Return to your cart" } }, no: { subject: "Discount Offer", content: { ...defaultContent, heading: "A little something for your cart", body: "Complete your order and enjoy 10% off your corals.", button: "Claim your offer" } } } } : {}) }) }, update: {} });
  const abandoned = await prisma.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "abandoned-cart" } } });
  if (abandoned && !(abandoned.data as { smsContent?: unknown }).smsContent) {
    await prisma.marketingResource.update({ where: { id: abandoned.id }, data: { data: { ...(abandoned.data as object), smsContent: { ...defaultContent, heading: "Still thinking it over?", body: "Your cart is waiting for you at Corals Anonymous.", button: "Complete your order" } } } });
  }
  if (abandoned && !(abandoned.data as { orderBranch?: unknown }).orderBranch) {
    await prisma.marketingResource.update({ where: { id: abandoned.id }, data: { data: { ...(abandoned.data as object), orderBranch: { yes: { subject: "Another Soft Push", content: { ...defaultContent, heading: "Your corals are still waiting", body: "Your order is not complete yet, but your cart is still saved.", button: "Return to your cart" } }, no: { subject: "Discount Offer", content: { ...defaultContent, heading: "A little something for your cart", body: "Complete your order and enjoy 10% off your corals.", button: "Claim your offer" } } } } } });
  }
  const b2b = await prisma.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "b2b-welcome" } } });
  if (b2b) { const data = b2b.data as { steps?: { content?: { heading?: string } }[] }; if (data.steps?.[0]?.content?.heading === defaultContent.heading) await prisma.marketingResource.update({ where: { id: b2b.id }, data: { data: { ...(b2b.data as object), steps: data.steps.map((step, index) => index === 0 ? { ...step, subject: "Welcome to Corals Anonymous Wholesale!", content: b2bContent } : step) } } }); }
  for (const [key, name, data] of [["mailable", "Mailable Subscribers · opened in 365 days", { openedDays: 365 }], ["b2b", "B2B Customers", { tag: "b2b" }]] as const) await prisma.marketingResource.upsert({ where: { shop_kind_key: { shop: shop(), kind: "SEGMENT", key } }, create: { shop: shop(), kind: "SEGMENT", key, name, data: json(data) }, update: {} });
  await prisma.marketingResource.upsert({ where: { shop_kind_key: { shop: shop(), kind: "TEMPLATE", key: "corals-standard" } }, create: { shop: shop(), kind: "TEMPLATE", key: "corals-standard", name: "Corals Anonymous standard", data: json(defaultContent) }, update: {} });
}
export function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }
export function signature(body: string, supplied: string | null, secret: string | undefined) { return !!secret && !!supplied && equal(crypto.createHmac("sha256", secret).update(body).digest("base64"), supplied); }
