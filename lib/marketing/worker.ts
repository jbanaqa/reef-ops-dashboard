import { prisma } from "@/lib/prisma";
import { audienceWhere, atomic, json, record, shop } from "./store";
import { Content, eligible, matches, Segment } from "./rules";
import { DeliveryError, resendProvider, setup, smsProvider } from "./delivery";
import { lowStock } from "./flows";

export async function runMarketing() {
  const config = setup();
  if (!config.sendingEnabled || !config.migrationConfirmed || !config.emailReady) return { skipped: "Complete setup and migration, then enable sending." };
  const now = new Date();
  // Never silently retry a job whose process may have died after provider acceptance.
  await prisma.marketingMessage.updateMany({ where: { shop: shop(), status: "SENDING", attemptedAt: { lt: new Date(+now - 300000) } }, data: { status: "UNKNOWN", error: "Worker stopped during delivery. Reconcile with provider." } });
  await lowStock();
  const campaigns = await prisma.marketingCampaign.findMany({ where: { shop: shop(), status: "SCHEDULED", scheduledAt: { lte: now } }, take: 20 });
  for (const campaign of campaigns) {
    // Expansion is cursor-paged and repeatable; uniqueness prevents duplicate recipients.
    let cursor: string | undefined;
    while (true) {
      const profiles = await prisma.marketingProfile.findMany({ where: audienceWhere(campaign.audience as Segment, campaign.channel), orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!profiles.length) break;
      await prisma.marketingMessage.createMany({ data: profiles.map(p => ({ shop: shop(), key: `campaign:${campaign.id}:${p.id}`, campaignId: campaign.id, profileId: p.id, channel: campaign.channel, subject: campaign.subject, content: json(campaign.content), dueAt: now })), skipDuplicates: true });
      cursor = profiles[profiles.length - 1].id;
    }
    await prisma.marketingCampaign.updateMany({ where: { id: campaign.id, status: "SCHEDULED" }, data: { status: "SENDING", expandedAt: now } });
  }
  const pending = await prisma.marketingMessage.findMany({ where: { shop: shop(), status: "PENDING", dueAt: { lte: now } }, orderBy: { dueAt: "asc" }, take: 50 });
  let sent = 0;
  for (const candidate of pending) {
    const message = await atomic(async tx => {
      const m = await tx.marketingMessage.findUnique({ where: { id: candidate.id }, include: { profile: { include: { consents: true } }, campaign: true } });
      if (!m || m.status !== "PENDING") return null;
      const c = m.profile.consents.find(c => c.channel === m.channel);
      const verification = m.flowKey === "email-confirmation";
      let reason = !eligible(c) && !verification ? "Not eligible for this channel" : null;
      if (verification && c?.suppressed) reason = "Address suppressed";
      if (m.campaign && (!['SENDING', 'SCHEDULED'].includes(m.campaign.status) || !matches(m.profile, m.campaign.audience as Segment))) reason = "Campaign cancelled or audience changed";
      if (m.flowKey && !verification) {
        const f = await tx.marketingResource.findUnique({ where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: m.flowKey } } });
        if (!f?.enabled) reason = "Flow paused";
      }
      if (m.flowKey === "abandoned-cart" && m.profile.lastOrderAt && m.triggerAt && m.profile.lastOrderAt >= m.triggerAt) reason = "Customer purchased after checkout";
      if (m.channel !== "EMAIL") {
        if (!config.smsReady) return null;
        // Default to conservative recipient-local SMS hours; unknown timezone cannot send.
        const zone = (m.profile.properties as { timezone?: string }).timezone;
        if (!zone) { await tx.marketingMessage.update({ where: { id: m.id }, data: { error: "Recipient timezone required for SMS" } }); return null; }
        const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(now));
        if (hour < 10 || hour >= 20) return null;
      }
      if (reason) { await tx.marketingMessage.update({ where: { id: m.id }, data: { status: "CANCELLED", error: reason } }); return null; }
      const claimed = await tx.marketingMessage.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "SENDING", attemptedAt: now, attempts: { increment: 1 }, error: null } });
      return claimed.count ? m : null;
    });
    if (!message) continue;
    try {
      const provider = message.channel === "EMAIL" ? resendProvider : smsProvider;
      const providerId = await provider.send({ id: message.id, to: message.channel === "EMAIL" ? message.profile.email! : message.profile.phone!, channel: message.channel, subject: message.subject, content: message.content as Content, unsubscribe: `${process.env.APP_BASE_URL}/api/marketing/unsubscribe?token=${message.token}` });
      await atomic(async tx => {
        await tx.marketingMessage.update({ where: { id: message.id }, data: { status: "SENT", sentAt: new Date(), providerId } });
        await record(tx, { key: `sent:${message.id}`, type: "SENT", profileId: message.profileId, messageId: message.id });
      });
      sent++;
    } catch (error) {
      const e = error instanceof DeliveryError ? error : new DeliveryError("Delivery outcome or persistence uncertain", true);
      await prisma.marketingMessage.update({ where: { id: message.id }, data: { status: e.uncertain ? "UNKNOWN" : e.retryable && message.attempts < 4 ? "PENDING" : "FAILED", error: e.message, dueAt: new Date(Date.now() + 60000 * 2 ** message.attempts) } });
    }
  }
  const active = await prisma.marketingCampaign.findMany({ where: { shop: shop(), status: "SENDING" }, select: { id: true } });
  for (const c of active) if (!await prisma.marketingMessage.count({ where: { campaignId: c.id, status: { in: ["PENDING", "SENDING", "UNKNOWN"] } } })) await prisma.marketingCampaign.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
  await prisma.marketingResource.upsert({ where: { shop_kind_key: { shop: shop(), kind: "SYSTEM", key: "worker" } }, create: { shop: shop(), kind: "SYSTEM", key: "worker", name: "Last worker run", data: { at: new Date().toISOString(), sent } }, update: { data: { at: new Date().toISOString(), sent } } });
  return { sent, inspected: pending.length };
}
