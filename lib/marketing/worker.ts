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
import { atomic, json, record, shop } from "./store";
import {
  Content,
  content,
  DAY,
  eligible,
  marketingSettings,
} from "./rules";
import { DeliveryError, resendProvider, setup, smsProvider } from "./delivery";
import { lowStock, stockStateKey } from "./stock";
import {
  validateStock,
  stockQuietHours,
  type StockConfig,
} from "./stock-config";
import { validateFlow } from "./flow-config";
import type { WelcomeConfig } from "./welcome-config";
import type { DeliveryUpsellConfig } from "./delivery-upsell-config";
import { resolveCampaignProductFeeds } from "./campaign-product-feed";
import { inboxUnresolved, processMarketingInbox } from "./inbox";
import { canConfirmEmailResubscription } from "./confirmation";
import {
  resolveCampaignAudience,
  resolvedAudienceMatches,
  resolvedAudienceWhere,
} from "./campaign-audience";
import {
  loadWelcome,
  welcomeHasOrderedSince,
  welcomeAudienceBlock,
  welcomeDependency,
  prepareWelcome,
  advanceWelcome,
  type WelcomeRun,
} from "./welcome";

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
    let preparedContent: Content;
    try {
      const savedSnapshot = await prisma.marketingResource.findUnique({
        where: {
          shop_kind_key: {
            shop: shop(),
            kind: "CAMPAIGN_FEED",
            key: campaign.id,
          },
        },
      });
      const savedContent = (savedSnapshot?.data as { content?: unknown } | null)?.content;
      preparedContent = savedContent
        ? content(savedContent)
        : await resolveCampaignProductFeeds(
            content(campaign.content),
            `campaign:${campaign.id}`,
          );
      if (!savedContent)
        await prisma.marketingResource.upsert({
          where: {
            shop_kind_key: {
              shop: shop(),
              kind: "CAMPAIGN_FEED",
              key: campaign.id,
            },
          },
          create: {
            shop: shop(),
            kind: "CAMPAIGN_FEED",
            key: campaign.id,
            name: `Campaign product snapshot: ${campaign.name}`,
            data: json({
              at: new Date().toISOString(),
              content: preparedContent,
            }),
          },
          update: {
            name: `Campaign product snapshot: ${campaign.name}`,
            data: json({
              at: new Date().toISOString(),
              content: preparedContent,
            }),
          },
        });
    } catch (error) {
      await prisma.marketingResource.upsert({
        where: {
          shop_kind_key: {
            shop: shop(),
            kind: "CAMPAIGN_FEED",
            key: campaign.id,
          },
        },
        create: {
          shop: shop(),
          kind: "CAMPAIGN_FEED",
          key: campaign.id,
          name: `Campaign product feed: ${campaign.name}`,
          data: json({
            at: new Date().toISOString(),
            error: error instanceof Error ? error.message : "Product feed failed",
          }),
        },
        update: {
          data: json({
            at: new Date().toISOString(),
            error: error instanceof Error ? error.message : "Product feed failed",
          }),
        },
      });
      continue;
    }
    // Expand only a bounded page per campaign/run. Exclude existing recipients
    // so interrupted/overlapping expansion resumes without rescanning all pages.
    await atomic(async (tx) => {
      const current = await tx.marketingCampaign.findUnique({
        where: { id: campaign.id },
      });
      if (current?.status !== "SCHEDULED") return;
      await tx.marketingCampaign.update({
        where: { id: current.id },
        data: { content: json(preparedContent) },
      });
      if (current.expandedAt) {
        await tx.marketingMessage.updateMany({
          where: { campaignId: current.id, status: "PENDING" },
          data: { content: json(preparedContent) },
        });
        await tx.marketingCampaign.update({
          where: { id: current.id },
          data: { status: "SENDING" },
        });
        return;
      }
      const resolved = await resolveCampaignAudience(tx, current.audience);
      const profiles = await tx.marketingProfile.findMany({
        where: {
          AND: [
            resolvedAudienceWhere(resolved, current.channel),
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
            content: json(preparedContent),
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
    let welcomeRun: WelcomeRun | null = null;
    let welcomePurchased = false;
    if (candidate.flowCondition?.startsWith("welcome-v1:")) {
      try {
        welcomeRun = await loadWelcome(candidate.profileId);
        if (candidate.flowStep === 1 || candidate.flowStep === 2) {
          const p = await prisma.marketingProfile.findUniqueOrThrow({
            where: { id: candidate.profileId },
          });
          if (!p.email) throw new Error("Subscriber email missing");
          const enteredAt = new Date(welcomeRun.enteredAt);
          welcomePurchased =
            (!!p.lastOrderAt && p.lastOrderAt >= enteredAt) ||
            (await welcomeHasOrderedSince(p.email, enteredAt));
        }
      } catch (error) {
        await prisma.marketingMessage.updateMany({
          where: { id: candidate.id, status: "PENDING" },
          data: {
            dueAt: new Date(Date.now() + 900000),
            error:
              "Waiting for welcome checks: " +
              (error instanceof Error ? error.message : "lookup failed"),
          },
        });
        continue;
      }
    }
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
      let liveWelcomeConfig: WelcomeConfig | undefined;
      let liveDeliveryConfig: DeliveryUpsellConfig | undefined;
      const isStock = m.flowKey === "low-stock";
      const verification = m.flowKey === "email-confirmation",
        consent = m.profile.consents.find((c) => c.channel === m.channel);
      let reason =
        !verification && !isStock && !eligible(consent)
          ? "Not eligible for this channel"
          : null;
      let deferred: string | null = null;
      let deferredUntil: Date | null = null;
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
          | {
              version?: number;
              expiresAt?: string;
              confirmed?: boolean;
              purpose?: string;
            }
          | undefined;
        const resubscription =
          d?.purpose === "resubscribe" &&
          canConfirmEmailResubscription(consent);
        if (
          (consent?.suppressed && !resubscription) ||
          !d ||
          d.version !== 2 ||
          d.confirmed ||
          !d.expiresAt ||
          new Date(d.expiresAt) <= new Date()
        )
          reason = "Confirmation expired, consumed, or suppressed";
      }
      if (m.campaign) {
        if (!["SENDING", "SCHEDULED"].includes(m.campaign.status))
          reason = "Campaign cancelled";
        else if (m.campaign.recipientMode === "SEND_TIME") {
          const resolved = await resolveCampaignAudience(tx, m.campaign.audience);
          if (!resolvedAudienceMatches(m.profile, resolved))
            reason = "No longer in the campaign audience";
        }
      }
      if (m.flowKey && !verification) {
        const f = await tx.marketingResource.findUnique({
          where: {
            shop_kind_key: { shop: shop(), kind: "FLOW", key: m.flowKey },
          },
        });
        if (!f?.enabled || !(f.data as { reviewed?: boolean }).reviewed)
          deferred = "Flow paused";
        if (
          ["b2b-welcome", "abandoned-cart", "welcome", "delivery-upsell"].includes(m.flowKey) &&
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
        if (m.flowKey === "delivery-upsell") {
          const live = f ? validateFlow("delivery-upsell", f.data) : null;
          liveDeliveryConfig = live?.delivery;
          if (!liveDeliveryConfig)
            deferred = "Review delivery upsell settings";
          else if (
            liveDeliveryConfig.testEmail &&
            liveDeliveryConfig.testEmail !== m.profile.email
          )
            reason = "Delivery upsell test audience changed";
        }
        if (
          m.flowKey === "welcome" &&
          (f?.data as { welcome?: unknown })?.welcome &&
          !welcomeRun
        )
          reason =
            "Legacy welcome replaced; existing subscribers are not re-enrolled";
        if (welcomeRun && f) {
          const live = validateFlow("welcome", f.data);
          liveWelcomeConfig = live.welcome;
          reason ||= welcomeAudienceBlock(live, welcomeRun, m.profile.email);
          const index = m.flowStep!;
          if (
            (index === 1 || index === 2) &&
            (welcomePurchased ||
              (!!m.profile.lastOrderAt &&
                m.profile.lastOrderAt >= new Date(welcomeRun.enteredAt)))
          )
            reason =
              "Customer ordered after joining this flow; discount reminder skipped";
          const dependency = await welcomeDependency(tx, m.profileId, index);
          if (dependency === "wait")
            deferred = "Waiting for welcome email delivery";
          else reason ||= dependency;
          if (index < 3) {
            const coupon = await tx.marketingResource.findUnique({
              where: {
                shop_kind_key: {
                  shop: shop(),
                  kind: "WELCOME_COUPON",
                  key: m.profileId,
                },
              },
            });
            const expires = (coupon?.data as { endsAt?: string } | undefined)
              ?.endsAt;
            if (expires && new Date(expires) <= new Date())
              reason = "Welcome discount expired; offer email skipped";
          }
        }
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
            const observedAt = cartRun.observedAt
              ? new Date(cartRun.observedAt)
              : null;
            const staleDue =
              observedAt &&
              m.dueAt.getTime() < observedAt.getTime() - 3 * DAY &&
              m.triggerAt &&
              observedAt > m.triggerAt;
            if (staleDue) {
              const smsMinutes = cartRun.config.cart?.testEmail
                ? 0
                : (cartRun.config.smsMinutes ?? 30);
              const firstMinutes = smsMinutes + cartRun.config.steps[0].minutes;
              const minutes =
                m.flowCondition === "cart-v1:sms"
                  ? smsMinutes
                  : m.flowCondition === "cart-v1:first"
                    ? firstMinutes
                    : firstMinutes + (cartRun.config.branchMinutes ?? 1440);
              await tx.marketingMessage.update({
                where: { id: m.id },
                data: {
                  status: "PENDING",
                  triggerAt: observedAt,
                  dueAt: new Date(+observedAt + minutes * 60000),
                  attemptedAt: null,
                  sentAt: null,
                  providerId: null,
                  attempts: 0,
                  error: null,
                },
              });
              return null;
            }
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
      if (
        (m.campaign ||
          cartRun ||
          welcomeRun ||
          liveDeliveryConfig ||
          m.flowKey === "b2b-welcome") &&
        !deferred
      ) {
        const intentBypassesRecentEmailSuppression =
          m.channel === "EMAIL" &&
          (m.flowKey === "delivery-upsell" ||
            m.flowKey === "b2b-welcome" ||
            (m.flowKey === "welcome" && m.flowStep === 0));
        const testBypassesRecentEmailSuppression =
          m.channel === "EMAIL" &&
          ((cartRun?.config.cart?.bypassRecentEmailSuppression === true &&
            !!cartRun?.config.cart.testEmail &&
            cartRun.config.cart.testEmail === m.profile.email) ||
            (welcomeRun?.testEmail === m.profile.email &&
              liveWelcomeConfig?.testEmail === m.profile.email &&
              liveWelcomeConfig.bypassRecentEmailSuppression === true));
        // In-flight and uncertain outcomes remain hard holds against duplicates,
        // including messages whose user intent exempts them from ordinary spacing.
        const reservation = await tx.marketingMessage.findFirst({
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
            status: { in: ["SENDING", "UNKNOWN"] },
          },
        });
        if (reservation) deferred = "Another message delivery is being checked";
        const campaignSmartSending =
          !m.campaign || m.campaign.smartSendingHours > 0;
        if (
          !reservation &&
          campaignSmartSending &&
          !intentBypassesRecentEmailSuppression &&
          !testBypassesRecentEmailSuppression
        ) {
          const windowHours = m.campaign
            ? m.campaign.smartSendingHours
            : m.channel === "EMAIL"
              ? 16
              : 24;
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
              status: "SENT",
              sentAt: {
                gte: new Date(Date.now() - windowHours * 3600000),
              },
            },
            orderBy: { sentAt: "desc" },
          });
          const externalEmail =
            m.channel === "EMAIL"
              ? await tx.marketingEvent.findFirst({
                  where: {
                    shop: shop(),
                    type: "EXTERNAL_EMAIL_SENT",
                    occurredAt: {
                      gte: new Date(Date.now() - windowHours * 3600000),
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
                  orderBy: { occurredAt: "desc" },
                })
              : null;
          if (recent?.sentAt || externalEmail?.occurredAt) {
            if (m.campaign) {
              await tx.marketingMessage.update({
                where: { id: m.id },
                data: {
                  status: "CANCELLED",
                  error: `Smart Sending: received another email within ${windowHours} hours`,
                },
              });
              return null;
            }
            const latest = Math.max(
              recent?.sentAt?.getTime() || 0,
              externalEmail?.occurredAt.getTime() || 0,
            );
            deferred =
              m.channel === "EMAIL"
                ? "Waiting for 16-hour email spacing"
                : "Waiting for 24-hour text spacing";
            deferredUntil = new Date(latest + windowHours * 3600000 + 1000);
          }
        }
      }
      if (deferred) {
        await tx.marketingMessage.update({
          where: { id: m.id },
          data: {
            dueAt: deferredUntil || new Date(Date.now() + 900000),
            error: deferred,
          },
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
      if (welcomeRun) {
        try {
          const readyKey = {
            shop: shop(),
            kind: "WELCOME_READY",
            key: message.id,
          };
          const ready = await prisma.marketingResource.findUnique({
            where: { shop_kind_key: readyKey },
          });
          if (ready) {
            const saved = ready.data as { content: Content; subject: string };
            message.content = JSON.parse(JSON.stringify(saved.content));
            message.subject = saved.subject;
          } else {
            message.content = JSON.parse(
              JSON.stringify(
                await prepareWelcome(
                  message.profileId,
                  message.flowStep!,
                  welcomeRun,
                ),
              ),
            );
            const live = await prisma.marketingResource.findUniqueOrThrow({
              where: {
                shop_kind_key: { shop: shop(), kind: "FLOW", key: "welcome" },
              },
            });
            message.subject = validateFlow("welcome", live.data).steps[
              message.flowStep!
            ].subject;
            await prisma.marketingResource.create({
              data: {
                ...readyKey,
                name: "Prepared welcome email",
                data: json({
                  content: message.content,
                  subject: message.subject,
                }),
              },
            });
          }
          await prisma.marketingMessage.update({
            where: { id: message.id },
            data: { content: json(message.content), subject: message.subject },
          });
          const latest = await prisma.marketingMessage.findUniqueOrThrow({
            where: { id: message.id },
            include: { profile: { include: { consents: true } } },
          });
          const live = await prisma.marketingResource.findUniqueOrThrow({
            where: {
              shop_kind_key: { shop: shop(), kind: "FLOW", key: "welcome" },
            },
          });
          const liveSettings = await prisma.marketingResource.findUnique({
            where: {
              shop_kind_key: { shop: shop(), kind: "SETTINGS", key: "global" },
            },
          });
          const state = marketingSettings(liveSettings?.data),
            gates = setup(state.operations, state.postalAddress);
          const expired = (message.content as Content).couponExpiresAt;
          const enteredAt = new Date(welcomeRun.enteredAt);
          const purchased =
            (message.flowStep === 1 || message.flowStep === 2) &&
            ((!!latest.profile.lastOrderAt &&
              latest.profile.lastOrderAt >= enteredAt) ||
              (await welcomeHasOrderedSince(
                latest.profile.email!,
                enteredAt,
              )));
          const block = welcomeAudienceBlock(
            validateFlow("welcome", live.data),
            welcomeRun,
            latest.profile.email,
          );
          if (latest.status !== "SENDING") continue;
          if (
            block ||
            purchased ||
            !eligible(
              latest.profile.consents.find((c) => c.channel === "EMAIL"),
            ) ||
            (expired && new Date(expired) <= new Date())
          ) {
            await prisma.marketingMessage.update({
              where: { id: message.id },
              data: {
                status: "CANCELLED",
                error:
                  block ||
                  "Purchase, consent, or discount expiration changed during preparation",
              },
            });
            continue;
          }
          if (
            !live.enabled ||
            !(live.data as { reviewed?: boolean }).reviewed ||
            !gates.sendingEnabled ||
            !gates.ingestEnabled ||
            !gates.emailReady ||
            !gates.migrationConfirmed ||
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
            "Welcome preparation: " +
              (error instanceof Error ? error.message : "failed"),
            false,
            true,
          );
        }
      }
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
        await advanceWelcome(tx, message);
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
