import { prisma } from "@/lib/prisma";
import { audienceWhere, atomic, json, record, shop } from "./store";
import {
  Content,
  content,
  DAY,
  eligible,
  marketingSettings,
  matches,
  Segment,
} from "./rules";
import { DeliveryError, resendProvider, setup, smsProvider } from "./delivery";
import { lowStock } from "./flows";
import { validateFlow } from "./flow-config";
import { inboxUnresolved, processMarketingInbox } from "./inbox";

export async function runMarketing() {
  const inbox = await processMarketingInbox();
  const settingsRow = await prisma.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" } },
  });
  const settings = marketingSettings(settingsRow?.data),
    config = setup(settings.operations, settings.postalAddress);
  const unresolved = await inboxUnresolved();
  const heartbeat = async (data: object) =>
    prisma.marketingResource.upsert({
      where: { shop_kind_key: { shop: shop(), kind: "SYSTEM", key: "worker" } },
      create: {
        shop: shop(),
        kind: "SYSTEM",
        key: "worker",
        name: "Last worker run",
        data: json({ at: new Date().toISOString(), inbox, ...data }),
      },
      update: { data: json({ at: new Date().toISOString(), inbox, ...data }) },
    });
  const now = new Date();
  await prisma.marketingMessage.updateMany({
    where: {
      shop: shop(),
      status: "SENDING",
      attemptedAt: { lt: new Date(+now - 300000) },
    },
    data: {
      status: "UNKNOWN",
      error: "Worker stopped during delivery. Reconcile with provider.",
    },
  });
  if (
    !config.sendingEnabled ||
    !config.migrationConfirmed ||
    !config.emailReady ||
    unresolved
  ) {
    const skipped = unresolved
      ? "Resolve or drain Shopify inbox before sending: " +
        unresolved +
        " event(s)."
      : "Complete setup and migration, then enable sending.";
    await heartbeat({ skipped, sent: 0 });
    return { skipped };
  }
  await lowStock();
  const deadline = Date.now() + 180000;
  const campaigns = await prisma.marketingCampaign.findMany({
    where: { shop: shop(), status: "SCHEDULED", scheduledAt: { lte: now } },
    take: 5,
    orderBy: { scheduledAt: "asc" },
  });
  for (const campaign of campaigns) {
    // Expand only a bounded page per campaign/run. Exclude existing recipients
    // so interrupted/overlapping expansion resumes without rescanning all pages.
    await atomic(async (tx) => {
      const current = await tx.marketingCampaign.findUnique({
        where: { id: campaign.id },
      });
      if (current?.status !== "SCHEDULED") return;
      const profiles = await tx.marketingProfile.findMany({
        where: {
          AND: [
            audienceWhere(campaign.audience as Segment, campaign.channel),
            { messages: { none: { campaignId: campaign.id } } },
          ],
        },
        orderBy: { id: "asc" },
        take: 500,
      });
      if (profiles.length)
        await tx.marketingMessage.createMany({
          data: profiles.map((p) => ({
            shop: shop(),
            key: "campaign:" + campaign.id + ":" + p.id,
            campaignId: campaign.id,
            profileId: p.id,
            channel: campaign.channel,
            subject: campaign.subject,
            content: json(campaign.content),
            dueAt: now,
          })),
          skipDuplicates: true,
        });
      if (profiles.length < 500)
        await tx.marketingCampaign.update({
          where: { id: campaign.id },
          data: { status: "SENDING", expandedAt: now },
        });
    });
  }
  // Reserve capacity for both automation and campaign email; SMS never crowds
  // either out. Deferred records receive a future dueAt before the next run.
  const emailFlow = await prisma.marketingMessage.findMany({
    where: {
      shop: shop(),
      status: "PENDING",
      channel: "EMAIL",
      campaignId: null,
      dueAt: { lte: now },
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  const emailCampaign = await prisma.marketingMessage.findMany({
    where: {
      shop: shop(),
      status: "PENDING",
      channel: "EMAIL",
      campaignId: { not: null },
      dueAt: { lte: now },
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  const sms = await prisma.marketingMessage.findMany({
    where: {
      shop: shop(),
      status: "PENDING",
      channel: { not: "EMAIL" },
      dueAt: { lte: now },
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: 50,
  });
  const pending = [...emailFlow, ...emailCampaign, ...sms];
  let sent = 0,
    inspected = 0,
    lastEmailAttempt = 0;
  for (const candidate of pending) {
    if (Date.now() > deadline) break;
    // Pace email within this process; provider 429 responses still back off.
    if (candidate.channel === "EMAIL" && Date.now() - lastEmailAttempt < 550)
      await new Promise((resolve) =>
        setTimeout(resolve, 550 - (Date.now() - lastEmailAttempt)),
      );
    inspected++;
    const claimed = await atomic(async (tx) => {
      const settingsRow = await tx.marketingResource.findUnique({
        where: {
          shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" },
        },
      });
      const settings = marketingSettings(settingsRow?.data),
        config = setup(settings.operations, settings.postalAddress);
      if (
        !config.sendingEnabled ||
        !config.migrationConfirmed ||
        !config.emailReady
      )
        return { stop: true } as const;
      if (
        await tx.marketingWebhookInbox.count({
          where: { shop: shop(), status: { not: "DONE" } },
        })
      )
        return { stop: true } as const;
      const m = await tx.marketingMessage.findUnique({
        where: { id: candidate.id },
        include: { profile: { include: { consents: true } }, campaign: true },
      });
      if (!m || m.status !== "PENDING") return null;
      const verification = m.flowKey === "email-confirmation",
        consent = m.profile.consents.find((c) => c.channel === m.channel);
      let reason =
        !verification && !eligible(consent)
          ? "Not eligible for this channel"
          : null;
      let deferred: string | null = null;
      if (m.channel === "EMAIL" ? !m.profile.email : !m.profile.phone)
        reason = "Recipient address missing";
      if (verification) {
        const session = await tx.marketingResource.findUnique({
          where: {
            shop_kind_key: {
              shop: shop(),
              kind: "SIGNUP",
              key: m.key.replace(/^confirmation:/, ""),
            },
          },
        });
        const d = session?.data as
          | { version?: number; expiresAt?: string; confirmed?: boolean }
          | undefined;
        if (
          consent?.suppressed ||
          !d ||
          d.version !== 2 ||
          d.confirmed ||
          !d.expiresAt ||
          new Date(d.expiresAt) <= new Date()
        )
          reason = "Confirmation expired, consumed, or suppressed";
      }
      if (
        m.campaign &&
        (!["SENDING", "SCHEDULED"].includes(m.campaign.status) ||
          !matches(m.profile, m.campaign.audience as Segment))
      )
        reason = "Campaign cancelled or audience changed";
      if (m.flowKey && !verification) {
        const f = await tx.marketingResource.findUnique({
          where: {
            shop_kind_key: { shop: shop(), kind: "FLOW", key: m.flowKey },
          },
        });
        if (!f?.enabled || !(f.data as { reviewed?: boolean }).reviewed)
          deferred = "Flow paused";
        if (
          ["b2b-welcome", "abandoned-cart"].includes(m.flowKey) &&
          !config.ingestEnabled
        )
          deferred = "Shopify ingestion paused";
        if (m.flowKey === "b2b-welcome" && !m.profile.tags.includes("b2b"))
          reason = "B2B tag removed";
        if (m.flowKey === "abandoned-cart") {
          if (!m.triggerAt || m.triggerAt < new Date(Date.now() - 3 * DAY))
            reason = "Checkout expired";
          else if (
            m.profile.lastOrderAt &&
            m.profile.lastOrderAt >= m.triggerAt
          )
            reason = "Customer purchased after checkout";
          else if (m.flowCondition === "ORDER_PLACED" && f) {
            // Legacy branch jobs always take the no-purchase branch. Snapshot
            // the validated output so history and retries reflect the send.
            try {
              const branch = validateFlow("abandoned-cart", f.data).orderBranch
                ?.no;
              if (branch) {
                m.subject = branch.subject;
                m.content = JSON.parse(
                  JSON.stringify({
                    ...branch.content,
                    url: (m.content as Content).url,
                  }),
                );
              }
            } catch {
              reason = "Invalid legacy cart branch configuration";
            }
          }
        }
      }
      if (reason) {
        await tx.marketingMessage.update({
          where: { id: m.id },
          data: { status: "CANCELLED", error: reason },
        });
        return null;
      }
      if (m.channel !== "EMAIL") {
        const zone = (m.profile.properties as { timezone?: string }).timezone;
        if (!config.smsReady) deferred = "SMS gateway not configured";
        else if (!zone) deferred = "Recipient timezone required for SMS";
        else {
          try {
            const hour = Number(
              new Intl.DateTimeFormat("en-US", {
                timeZone: zone,
                hour: "numeric",
                hourCycle: "h23",
              }).format(new Date()),
            );
            if (hour < 10 || hour >= 20) deferred = "Recipient quiet hours";
          } catch {
            deferred = "Invalid recipient timezone";
          }
        }
      }
      if (deferred) {
        await tx.marketingMessage.update({
          where: { id: m.id },
          data: { dueAt: new Date(Date.now() + 900000), error: deferred },
        });
        return null;
      }
      try {
        m.content = JSON.parse(JSON.stringify(content(m.content)));
      } catch (e) {
        await tx.marketingMessage.update({
          where: { id: m.id },
          data: {
            status: "FAILED",
            error:
              "Invalid content: " +
              (e instanceof Error ? e.message : "validation failed"),
          },
        });
        return null;
      }
      const result = await tx.marketingMessage.updateMany({
        where: { id: m.id, status: "PENDING" },
        data: {
          status: "SENDING",
          attemptedAt: new Date(),
          attempts: { increment: 1 },
          error: null,
          subject: m.subject,
          content: json(m.content),
        },
      });
      return result.count ? { message: m, settings } : null;
    });
    if (claimed && "stop" in claimed) break;
    if (!claimed) continue;
    const { message, settings } = claimed;
    try {
      const provider =
        message.channel === "EMAIL" ? resendProvider : smsProvider;
      if (message.channel === "EMAIL") lastEmailAttempt = Date.now();
      const providerId = await provider.send({
        id: message.id,
        to:
          message.channel === "EMAIL"
            ? message.profile.email!
            : message.profile.phone!,
        channel: message.channel,
        subject: message.subject,
        content: message.content as Content,
        profileName: message.profile.name,
        address: settings.postalAddress,
        organizationName: settings.organizationName,
        unsubscribe:
          process.env.APP_BASE_URL +
          "/api/marketing/unsubscribe?token=" +
          message.token,
      });
      await atomic(async (tx) => {
        await tx.marketingMessage.update({
          where: { id: message.id },
          data: { status: "SENT", sentAt: new Date(), providerId },
        });
        await record(tx, {
          key: "sent:" + message.id,
          type: "SENT",
          profileId: message.profileId,
          messageId: message.id,
        });
      });
      sent++;
    } catch (error) {
      const e =
        error instanceof DeliveryError
          ? error
          : new DeliveryError(
              "Delivery outcome or persistence uncertain",
              true,
            );
      await prisma.marketingMessage.update({
        where: { id: message.id },
        data: {
          status: e.uncertain
            ? "UNKNOWN"
            : e.retryable && message.attempts < 6
              ? "PENDING"
              : "FAILED",
          error: e.message,
          dueAt: new Date(
            Date.now() +
              Math.max(60000 * 2 ** message.attempts, e.retryAfterMs),
          ),
        },
      });
    }
  }
  const active = await prisma.marketingCampaign.findMany({
    where: { shop: shop(), status: "SENDING" },
    select: { id: true },
  });
  for (const c of active)
    if (
      !(await prisma.marketingMessage.count({
        where: {
          campaignId: c.id,
          status: { in: ["PENDING", "SENDING", "UNKNOWN"] },
        },
      }))
    )
      await prisma.marketingCampaign.updateMany({
        where: { id: c.id, status: "SENDING" },
        data: { status: "COMPLETED" },
      });
  // Only transient records are retained for a short time; consent/event history remains.
  await prisma.marketingResource.deleteMany({
    where: {
      shop: shop(),
      kind: { in: ["RATE", "SIGNUP", "CONFIRMATION"] },
      updatedAt: { lt: new Date(Date.now() - 7 * DAY) },
    },
  });
  await heartbeat({ sent, inspected });
  return { sent, inspected };
}
