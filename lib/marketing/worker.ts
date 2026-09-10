import { cartTestBlock, type CartConfig } from "./cart-config";
import {
  CartRun,
  advanceCart,
  loadCart,
  cartLastOrder,
  cartDependency,
  cartProducts,
  cartCoupon,
} from "./cart";
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
import { lowStock, stockStateKey } from "./stock";
import {
  validateStock,
  stockQuietHours,
  type StockConfig,
} from "./stock-config";
import { validateFlow } from "./flow-config";
import { inboxUnresolved, processMarketingInbox } from "./inbox";

export async function runMarketing(onlyMessageId?: string) {
  const inbox = onlyMessageId ? null : await processMarketingInbox();
  const settingsRow = await prisma.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" } },
  });
  const settings = marketingSettings(settingsRow?.data),
    config = setup(settings.operations, settings.postalAddress);
  const unresolved = await inboxUnresolved();
  const heartbeat = async (data: object) => {
    if (onlyMessageId) return;
    return prisma.marketingResource.upsert({
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
  };
  const now = new Date();
  await prisma.marketingMessage.updateMany({
    where: {
      shop: shop(),
      status: "SENDING",
      ...(onlyMessageId ? { id: onlyMessageId } : {}),
      attemptedAt: { lt: new Date(+now - 300000) },
    },
    data: {
      status: "UNKNOWN",
      error: "Worker stopped during delivery. Reconcile with provider.",
    },
  });
  let stockCheck: Awaited<ReturnType<typeof lowStock>> | null = null;
  try {
    if (!onlyMessageId) stockCheck = await lowStock();
  } catch (error) {
    await prisma.marketingResource.upsert({
      where: {
        shop_kind_key: { shop: shop(), kind: "SYSTEM", key: "stock-check" },
      },
      create: {
        shop: shop(),
        kind: "SYSTEM",
        key: "stock-check",
        name: "Last stock check",
        data: {
          at: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Stock check failed",
        },
      },
      update: {
        data: {
          at: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Stock check failed",
        },
      },
    });
  }
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
  now.setTime(Date.now());
  const deadline = Date.now() + 180000;
  const campaigns = onlyMessageId
    ? []
    : await prisma.marketingCampaign.findMany({
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
      ...(onlyMessageId ? { id: onlyMessageId } : {}),
      shop: shop(),
      status: "PENDING",
      channel: "EMAIL",
      campaignId: null,
      dueAt: { lte: now },
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  const emailCampaign = onlyMessageId
    ? []
    : await prisma.marketingMessage.findMany({
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
  const sms = onlyMessageId
    ? []
    : await prisma.marketingMessage.findMany({
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
    let cartRun: CartRun | null = null;
    let shopifyOrder: Date | null = null;
    if (candidate.flowCondition?.startsWith("cart-v1:")) {
      try {
        cartRun = await loadCart(candidate.key);
        const p = await prisma.marketingProfile.findUniqueOrThrow({
          where: { id: candidate.profileId },
        });
        if (!p.email || !candidate.triggerAt)
          throw new Error("Checkout identity is incomplete");
        shopifyOrder = await cartLastOrder(p.email, candidate.triggerAt);
      } catch (error) {
        await prisma.marketingMessage.updateMany({
          where: { id: candidate.id, status: "PENDING" },
          data: {
            dueAt: new Date(Date.now() + 900000),
            error:
              "Waiting for checkout checks: " +
              (error instanceof Error ? error.message : "lookup failed"),
          },
        });
        continue;
      }
    }
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
      if (!m || m.status !== "PENDING" || m.dueAt > new Date()) return null;
      let stockSettings: StockConfig | null = null;
      const isStock = m.flowKey === "low-stock";
      const verification = m.flowKey === "email-confirmation",
        consent = m.profile.consents.find((c) => c.channel === m.channel);
      let reason =
        !verification && !isStock && !eligible(consent)
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
        if (isStock) {
          try {
            stockSettings = validateStock(
              (f?.data as { stock?: unknown })?.stock,
              true,
            );
            const s = stockSettings;
            const enabledChannel =
              m.channel === "EMAIL"
                ? s.emailEnabled
                : m.channel === "SMS_TRANSACTIONAL" && s.smsEnabled;
            if (
              !enabledChannel ||
              m.profile.email !== s.recipientEmail ||
              (m.channel !== "EMAIL" && m.profile.phone !== s.recipientPhone)
            )
              reason = "Staff recipient or alert channel changed";
            if (consent?.suppressed || consent?.status === "UNSUBSCRIBED")
              reason = "Staff alert channel suppressed";
            const match = m.flowCondition?.match(
              /^stock:(v2:[a-f0-9]+:[0-9]+):([0-9]+)$/,
            );
            if (!match) reason = "Legacy stock alert needs review";
            else {
              const state = await tx.marketingResource.findUnique({
                where: {
                  shop_kind_key: { shop: shop(), kind: "STOCK", key: match[1] },
                },
              });
              const d = state?.data as
                | {
                    low?: boolean;
                    cycle?: number;
                    variantId?: string;
                    observedAt?: string;
                  }
                | undefined;
              if (
                !d?.low ||
                d.cycle !== Number(match[2]) ||
                !d.variantId ||
                stockStateKey(s, d.variantId) !== match[1]
              )
                reason = "Stock recovered or monitoring rules changed";
              if (!stockCheck || !("observedAt" in stockCheck))
                deferred = "Waiting for a successful stock check";
              else if (
                !d?.observedAt ||
                new Date(d.observedAt) < new Date(stockCheck.observedAt)
              )
                reason = "Variant no longer monitored";
            }
            if (!config.ingestEnabled) deferred = "Shopify ingestion paused";
          } catch {
            deferred = "Review stock alert settings";
          }
        }
        if (m.flowKey === "b2b-welcome" && !m.profile.tags.includes("b2b"))
          reason = "B2B tag removed";
        if (m.flowKey === "abandoned-cart") {
          const testBlock = cartTestBlock(
            (f?.data as { cart?: CartConfig })?.cart,
            cartRun,
            m.profile.email,
            m.channel,
          );
          if (testBlock) {
            await tx.marketingMessage.update({
              where: { id: m.id },
              data: { status: "CANCELLED", error: testBlock },
            });
            return null;
          }
          if (!cartRun && (f?.data as { cart?: unknown })?.cart)
            reason =
              "Legacy cart reminder replaced; a new checkout is required";
          if (cartRun) {
            if (m.channel !== "EMAIL")
              m.content = JSON.parse(
                JSON.stringify({ ...(m.content as Content), url: cartRun.url }),
              );
            if (m.flowCondition === "cart-v1:first" && m.attempts === 0) {
              m.subject = cartRun.config.steps[0].subject;
              m.content = JSON.parse(
                JSON.stringify({
                  ...cartRun.config.steps[0].content,
                  url: cartRun.url,
                  products: [],
                  couponCode: undefined,
                }),
              );
            }
            const purchased = [m.profile.lastOrderAt, shopifyOrder].some(
              (d) => d && m.triggerAt && d >= m.triggerAt,
            );
            if (purchased) reason = "Customer purchased after checkout";
            const dependency = await cartDependency(tx, m, cartRun);
            if (dependency && !reason) {
              await tx.marketingMessage.update({
                where: { id: m.id },
                data: {
                  dueAt: dependency,
                  error: "Waiting for the previous step and its delay",
                },
              });
              return null;
            }
            // Snapshot branch at first claim; retries keep the same email and code.
            if (m.flowCondition === "cart-v1:final" && m.attempts === 0) {
              const recent = [m.profile.lastOrderAt, shopifyOrder].some(
                (d) => d && +d >= Date.now() - 14 * DAY,
              );
              const branch = cartRun.config.orderBranch![recent ? "yes" : "no"];
              m.subject = branch.subject;
              m.content = JSON.parse(
                JSON.stringify({
                  ...branch.content,
                  url: cartRun.url,
                  products: [],
                  couponCode: undefined,
                }),
              );
              m.flowCondition = recent
                ? "cart-v1:final-yes"
                : "cart-v1:final-no";
            }
          } else if (
            !m.triggerAt ||
            m.triggerAt < new Date(Date.now() - 3 * DAY)
          )
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
        await advanceCart(tx, m);
        return null;
      }
      if (m.channel !== "EMAIL") {
        const zone =
          stockSettings?.timezone ||
          (m.profile.properties as { timezone?: string }).timezone;
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
            if (
              stockSettings
                ? stockQuietHours(zone)
                : hour < (cartRun ? 11 : 10) || hour >= 20
            )
              deferred = "Recipient quiet hours";
          } catch {
            deferred = "Invalid recipient timezone";
          }
        }
      }
      if (cartRun && !deferred) {
        const bypassRecentEmailSuppression =
          m.channel === "EMAIL" &&
          cartRun.config.cart?.bypassRecentEmailSuppression === true &&
          !!cartRun.config.cart.testEmail &&
          cartRun.config.cart.testEmail === m.profile.email;
        if (!bypassRecentEmailSuppression) {
        // Reserve against concurrent claims as well as already sent messages.
        const recent = await tx.marketingMessage.findFirst({
          where: {
            shop: shop(),
            profileId: m.profileId,
            id: { not: m.id },
            channel:
              m.channel === "EMAIL"
                ? "EMAIL"
                : { in: ["SMS_MARKETING", "SMS_TRANSACTIONAL"] },
            AND: [
              {
                OR: [
                  { flowKey: null },
                  { flowKey: { not: "email-confirmation" } },
                ],
              },
            ],
            OR: [
              {
                status: "SENT",
                sentAt: {
                  gte: new Date(
                    Date.now() - (m.channel === "EMAIL" ? 16 : 24) * 3600000,
                  ),
                },
              },
              { status: { in: ["SENDING", "UNKNOWN"] } },
            ],
          },
        });
        const externalEmail =
          m.channel === "EMAIL"
            ? await tx.marketingEvent.findFirst({
                where: {
                  shop: shop(),
                  type: "EXTERNAL_EMAIL_SENT",
                  occurredAt: {
                    gte: new Date(Date.now() - 16 * 3600000),
                    lte: new Date(),
                  },
                  OR: [
                    { profileId: m.profileId },
                    {
                      payload: {
                        path: ["email"],
                        equals: m.profile.email || "",
                      },
                    },
                  ],
                },
              })
            : null;
        if (externalEmail)
          reason =
            "Skipped: recently received email through Klaviyo (16 hours)";
        if (recent) {
          if (recent.status === "SENT")
            reason =
              "Skipped: recently received " +
              (m.channel === "EMAIL" ? "email (16 hours)" : "text (24 hours)");
          else deferred = "Another message delivery is being checked";
        }
        if (reason) {
          await tx.marketingMessage.update({
            where: { id: m.id },
            data: { status: "CANCELLED", error: reason },
          });
          await advanceCart(tx, m);
          return null;
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
          flowCondition: m.flowCondition,
          content: json(m.content),
        },
      });
      return result.count ? { message: m, settings } : null;
    });
    if (claimed && "stop" in claimed) break;
    if (!claimed) continue;
    const { message, settings } = claimed;
    try {
      if (cartRun && message.channel === "EMAIL") {
        try {
          const c = message.content as Content;
          const readyKey = {
            shop: shop(),
            kind: "CART_READY",
            key: message.id,
          };
          const ready = await prisma.marketingResource.findUnique({
            where: { shop_kind_key: readyKey },
          });
          if (ready) message.content = ready.data;
          else {
            const products = await cartProducts(cartRun);
            const couponCode =
              message.flowCondition === "cart-v1:final-no"
                ? await cartCoupon(message.id)
                : undefined;
            message.content = JSON.parse(
              JSON.stringify(
                content({ ...c, url: cartRun.url, products, couponCode }),
              ),
            );
            await prisma.marketingResource.create({
              data: {
                ...readyKey,
                name: "Prepared cart email",
                data: json(message.content),
              },
            });
          }
          await prisma.marketingMessage.update({
            where: { id: message.id },
            data: { content: json(message.content) },
          });
          // Recheck local stop switches after product/discount API calls.
          const latest = await prisma.marketingMessage.findUniqueOrThrow({
            where: { id: message.id },
            include: { profile: { include: { consents: true } } },
          });
          const refreshedOrder = await cartLastOrder(
            latest.profile.email!,
            message.triggerAt!,
          );
          const liveFlow = await prisma.marketingResource.findUnique({
            where: {
              shop_kind_key: {
                shop: shop(),
                kind: "FLOW",
                key: "abandoned-cart",
              },
            },
          });
          const liveSettings = await prisma.marketingResource.findUnique({
            where: {
              shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" },
            },
          });
          const liveSetup = setup(
            marketingSettings(liveSettings?.data).operations,
            settings.postalAddress,
          );
          if (latest.status !== "SENDING") continue;
          const testBlock = cartTestBlock(
            (liveFlow?.data as { cart?: CartConfig })?.cart,
            cartRun,
            latest.profile.email,
            message.channel,
          );
          if (testBlock) {
            await prisma.marketingMessage.update({
              where: { id: message.id },
              data: { status: "CANCELLED", error: testBlock },
            });
            continue;
          }
          if (
            (refreshedOrder &&
              message.triggerAt &&
              refreshedOrder >= message.triggerAt) ||
            !eligible(
              latest.profile.consents.find((c) => c.channel === "EMAIL"),
            ) ||
            (latest.profile.lastOrderAt &&
              message.triggerAt &&
              latest.profile.lastOrderAt >= message.triggerAt)
          ) {
            await prisma.marketingMessage.update({
              where: { id: message.id },
              data: {
                status: "CANCELLED",
                error: "Purchase or consent changed during preparation",
              },
            });
            continue;
          }
          if (
            !liveFlow?.enabled ||
            !(liveFlow.data as { reviewed?: boolean }).reviewed ||
            !liveSetup.sendingEnabled ||
            !liveSetup.ingestEnabled ||
            !liveSetup.migrationConfirmed ||
            (await inboxUnresolved())
          ) {
            await prisma.marketingMessage.update({
              where: { id: message.id },
              data: {
                status: "PENDING",
                dueAt: new Date(Date.now() + 900000),
                error: "Sending paused during preparation",
              },
            });
            continue;
          }
        } catch (error) {
          throw new DeliveryError(
            "Email preparation: " +
              (error instanceof Error ? error.message : "failed"),
            false,
            true,
          );
        }
      }
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
        branding: settings.branding,
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
        await advanceCart(tx, message);
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
      await atomic(async (tx) => {
        const updated = await tx.marketingMessage.update({
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
        if (updated.status === "FAILED") await advanceCart(tx, updated);
      });
    }
  }
  const active = onlyMessageId
    ? []
    : await prisma.marketingCampaign.findMany({
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
  if (!onlyMessageId)
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
