import { prisma } from "@/lib/prisma";
import { shopifyGraphql } from "@/lib/shopify";
import { type FlowConfig, validateFlow } from "./flow-config";
import { content, couponTimeLeft, eligible, type Content } from "./rules";
import { json, record, shop, type Tx } from "./store";
import { uniqueDiscount, type SavedDiscount } from "./discounts";
import { welcomeLabels, upgradeWelcomeStep } from "./welcome-config";
import { resolveWelcomeSocialProducts } from "./campaign-product-feed";

export type WelcomeRun = {
  profileId: string;
  enteredAt: string;
  timezone: string;
  config: FlowConfig;
  testEmail?: string;
};
const runWhere = (profileId: string) => ({
  shop_kind_key: { shop: shop(), kind: "WELCOME_RUN", key: profileId },
});
export const welcomeMessageKey = (profileId: string, step: number) =>
  `welcome-v1:${profileId}:${step}`;

/** First local clock hour at or after a deadline; works across DST without adding a guessed UTC offset. */
export function welcomeLocalHour(at: Date, timezone: string, hour: number) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const cursor = new Date(Math.ceil(+at / 60000) * 60000);
  for (let i = 0; i <= 26 * 60; i++, cursor.setTime(+cursor + 60000)) {
    const parts = formatter.formatToParts(cursor);
    if (
      Number(parts.find((p) => p.type === "hour")?.value) === hour &&
      Number(parts.find((p) => p.type === "minute")?.value) === 0
    )
      return cursor;
  }
  throw new Error("Could not resolve recipient's send time");
}
export async function enrollWelcome(
  tx: Tx,
  profileId: string,
  at: Date,
  config: FlowConfig,
) {
  if (!config.welcome) return;
  const p = await tx.marketingProfile.findUniqueOrThrow({
    where: { id: profileId },
    include: { consents: true },
  });
  if (
    !p.email ||
    !eligible(p.consents.find((c) => c.channel === "EMAIL")) ||
    (config.welcome.testEmail && p.email !== config.welcome.testEmail)
  )
    return;
  // A legacy welcome counts as an entry too. Upgrading must never re-email the existing list.
  if (
    (await tx.marketingResource.findUnique({ where: runWhere(profileId) })) ||
    (await tx.marketingMessage.findFirst({
      where: { shop: shop(), profileId, flowKey: "welcome" },
    }))
  )
    return;
  let timezone =
    (p.properties as { timezone?: string }).timezone ||
    config.welcome.fallbackTimezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    timezone = config.welcome.fallbackTimezone;
  }
  const run: WelcomeRun = {
    profileId,
    enteredAt: at.toISOString(),
    timezone,
    config,
    ...(config.welcome.testEmail
      ? { testEmail: config.welcome.testEmail }
      : {}),
  };
  await tx.marketingResource.create({
    data: {
      ...runWhere(profileId).shop_kind_key,
      name: "Welcome series enrollment",
      data: json(run),
    },
  });
  for (const [i, step] of config.steps.entries()) {
    const due = new Date(+at + step.minutes * 60000);
    await tx.marketingMessage.create({
      data: {
        shop: shop(),
        key: welcomeMessageKey(profileId, i),
        profileId,
        flowKey: "welcome",
        flowStep: i,
        flowCondition: `welcome-v1:${i}`,
        triggerAt: at,
        dueAt:
          i === 3
            ? welcomeLocalHour(due, timezone, config.welcome.socialHour)
            : due,
        channel: "EMAIL",
        subject: step.subject,
        content: json({
          ...step.content,
          couponCode: undefined,
          couponExpiresAt: undefined,
        }),
      },
    });
  }
  await record(tx, {
    key: `welcome-entered:${profileId}`,
    type: "WELCOME_ENTERED",
    profileId,
    occurredAt: at,
    payload: { list: "Mailable Subscribers", test: !!run.testEmail },
  });
}
export async function loadWelcome(profileId: string): Promise<WelcomeRun> {
  const row = await prisma.marketingResource.findUnique({
    where: runWhere(profileId),
  });
  if (!row) throw new Error("Welcome enrollment not found");
  const run = row.data as unknown as WelcomeRun;
  validateFlow("welcome", run.config);
  return run;
}
export function welcomeAudienceBlock(
  live: FlowConfig,
  run: WelcomeRun,
  email: string | null,
) {
  if (!live.welcome) return "Welcome setup needs review";
  if (
    (live.welcome.testEmail && live.welcome.testEmail !== email) ||
    (run.testEmail &&
      (run.testEmail !== email || live.welcome.testEmail !== run.testEmail)) ||
    (!run.testEmail && live.welcome.testEmail)
  )
    return "Welcome test audience changed";
  return null;
}
/** Check only purchases made after this subscriber entered the Welcome flow. */
export async function welcomeHasOrderedSince(
  email: string,
  enteredAt: Date,
): Promise<boolean> {
  if (!Number.isFinite(+enteredAt))
    throw new Error("Welcome enrollment time is invalid");
  const r = await shopifyGraphql<{
    data?: { orders?: { nodes: { id: string; createdAt: string }[] } };
  }>(
    `query WelcomePurchaseCheck($query: String!) { orders(first: 1, sortKey: CREATED_AT, reverse: true, query: $query) { nodes { id createdAt } } }`,
    {
      query:
        "email:" +
        JSON.stringify(email) +
        " test:false created_at:>=" +
        enteredAt.toISOString(),
    },
  );
  if (!r.data?.orders)
    throw new Error("Purchase history could not be checked");
  return r.data.orders.nodes.length > 0;
}
export async function welcomeDependency(
  tx: Tx,
  profileId: string,
  step: number,
) {
  if (step === 0) return null;
  const first = await tx.marketingMessage.findUnique({
    where: { key: welcomeMessageKey(profileId, 0) },
  });
  if (!first) return "Welcome email missing";
  if (["PENDING", "SENDING", "UNKNOWN"].includes(first.status)) return "wait";
  if (step !== 3 && first.status !== "SENT")
    return "Welcome offer was not sent; discount reminder skipped";
  return null;
}
/** Anchor the complete offer timeline only after the first email has been accepted. */
export async function advanceWelcome(
  tx: Tx,
  m: { profileId: string; flowCondition: string | null },
) {
  if (m.flowCondition !== "welcome-v1:0") return;
  const row = await tx.marketingResource.findUnique({
    where: runWhere(m.profileId),
  });
  const discount = await tx.marketingResource.findUnique({
    where: {
      shop_kind_key: { shop: shop(), kind: "WELCOME_COUPON", key: m.profileId },
    },
  });
  if (!row || !discount) return;
  const run = row.data as unknown as WelcomeRun,
    saved = discount.data as SavedDiscount;
  for (let i = 1; i < 4; i++) {
    const due = new Date(
      Date.parse(saved.startsAt) + run.config.steps[i].minutes * 60000,
    );
    await tx.marketingMessage.updateMany({
      where: {
        key: welcomeMessageKey(m.profileId, i),
        status: "PENDING",
        attempts: 0,
      },
      data: {
        dueAt:
          i === 3
            ? welcomeLocalHour(
                due,
                run.timezone,
                run.config.welcome!.socialHour,
              )
            : due,
        error: null,
      },
    });
  }
}
export async function prepareWelcome(
  profileId: string,
  step: number,
  run: WelcomeRun,
): Promise<Content> {
  // Never mint an offer for a reminder or extend its deadline on retry.
  const discount =
    step < 3
      ? step === 0
        ? await uniqueDiscount(profileId, {
            kind: "WELCOME_COUPON",
            name: "Welcome10",
            prefix: "WELCOME10-",
            days: run.config.welcome!.couponDays,
          })
        : ((
            await prisma.marketingResource.findUnique({
              where: {
                shop_kind_key: {
                  shop: shop(),
                  kind: "WELCOME_COUPON",
                  key: profileId,
                },
              },
            })
          )?.data as SavedDiscount | undefined)
      : undefined;
  if (
    step < 3 &&
    (!discount?.discountId || new Date(discount.endsAt) <= new Date())
  )
    throw new Error("Welcome discount is unavailable or expired");
  let c = run.config.steps[step].content;
  // Use the latest editor copy until the first preparation. Subsequent retries use WELCOME_READY.
  const live = await prisma.marketingResource.findUnique({
    where: { shop_kind_key: { shop: shop(), kind: "FLOW", key: "welcome" } },
  });
  if (live && (live.data as unknown as FlowConfig).welcome)
    c = validateFlow("welcome", live.data).steps[step].content;
  c = upgradeWelcomeStep(c, step);
  const expires = discount
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: run.timezone,
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date(discount.endsAt)) +
      " (" +
      run.timezone +
      ")"
    : "";
  const url = new URL(c.url);
  // Keep the merchant's chosen destination, applying the assigned discount at Shopify.
  const destination = discount
    ? `https://coralsanonymous.com/discount/${encodeURIComponent(discount.code)}?redirect=${encodeURIComponent(url.pathname + url.search)}`
    : c.url;
  return content(await resolveWelcomeSocialProducts({
    ...c,
    url: destination,
    body: c.body.replaceAll("{{ coupon_expires }}", expires).replaceAll("{{ coupon_time_left }}", couponTimeLeft(discount?.endsAt)),
    bodyHtml: c.bodyHtml?.replaceAll("{{ coupon_expires }}", expires).replaceAll("{{ coupon_time_left }}", couponTimeLeft(discount?.endsAt)),
    couponCode: discount?.code,
    couponExpiresAt: discount?.endsAt,
  }, profileId));
}
export { welcomeLabels };
