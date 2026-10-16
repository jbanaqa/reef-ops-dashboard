import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { shop } from "./store";

async function deliveryAttentionProfiles(enrollments: Prisma.MarketingEventWhereInput) {
  const profiles = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.marketingEvent.findMany({
      where: {
        shop: shop(), type: { in: ["BOUNCED", "COMPLAINED"] }, messageId: { not: null },
        profile: { is: { shop: shop(), events: { some: enrollments } } },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" }, take: 500, select: { id: true, messageId: true },
    });
    if (page.length) {
      const messages = await prisma.marketingMessage.findMany({
        where: { shop: shop(), flowKey: "welcome", id: { in: page.map((event) => event.messageId!) } },
        select: { profileId: true }, distinct: ["profileId"],
      });
      for (const message of messages) profiles.add(message.profileId);
    }
    if (page.length < 500) return [...profiles];
    cursor = page[page.length - 1].id;
  }
}

/** Read-only enrollment ledger: never expose saved email content or delivery tokens. */
export async function welcomeActivity(url: URL) {
  const scope = url.searchParams.get("scope") || "live";
  if (!["live", "all"].includes(scope)) throw Error("Choose a valid activity period.");
  const activation = await prisma.marketingEvent.findFirst({
    where: { shop: shop(), type: "CONFIG_CHANGED", key: { startsWith: "welcome-enabled:" } },
    orderBy: { occurredAt: "asc" }, select: { occurredAt: true },
  });
  const query = (url.searchParams.get("q") || "").trim().slice(0, 254);
  const where: Prisma.MarketingEventWhereInput = {
    shop: shop(), type: "WELCOME_ENTERED", profileId: { not: null },
    OR: [
      { NOT: { payload: { path: ["test"], equals: true } } },
      { payload: { path: ["test"], equals: Prisma.DbNull } },
    ],
    ...(scope === "live" ? activation
      ? { createdAt: { gte: activation.occurredAt } }
      : { id: "activation-not-recorded" } : {}),
    profile: { is: {
      shop: shop(),
      ...(query ? { OR: ["email", "name"].map((field) => ({ [field]: { contains: query, mode: "insensitive" } })) } : {}),
    } },
  };
  const cursor = url.searchParams.get("cursor");
  if (cursor && !(await prisma.marketingEvent.findFirst({ where: { AND: [where, { id: cursor }] }, select: { id: true } })))
    throw Error("This activity page changed. Return to the first page.");
  const firstMessage = (status: string[]): Prisma.MarketingEventWhereInput => ({
    AND: [where, { profile: { is: { messages: { some: {
      shop: shop(), flowKey: "welcome", flowStep: 0, status: { in: status },
    } } } } }],
  });
  const [page, joined, sent, waiting, deliveryIssues] = await Promise.all([
    prisma.marketingEvent.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 26,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, createdAt: true, occurredAt: true,
        profile: { select: {
          id: true, name: true, email: true,
          messages: {
            where: { shop: shop(), flowKey: "welcome" }, orderBy: [{ flowStep: "asc" }, { createdAt: "asc" }], take: 8,
            select: { id: true, flowStep: true, status: true, dueAt: true, sentAt: true, error: true },
          },
        } },
      },
    }),
    prisma.marketingEvent.count({ where }),
    prisma.marketingEvent.count({ where: firstMessage(["SENT"]) }),
    prisma.marketingEvent.count({ where: firstMessage(["PENDING", "SENDING"]) }),
    deliveryAttentionProfiles(where),
  ]);
  const attention = await prisma.marketingEvent.count({ where: { AND: [where, { OR: [
    { profileId: { in: deliveryIssues } },
    { profile: { is: { messages: { some: {
      shop: shop(), flowKey: "welcome", status: { in: ["FAILED", "UNKNOWN"] },
    } } } } },
  ] }] } });
  const rows = page.slice(0, 25);
  const events = await prisma.marketingEvent.findMany({
    where: {
      shop: shop(), messageId: { in: rows.flatMap((row) => row.profile?.messages.map((m) => m.id) || []) },
      type: { in: ["DELIVERED", "OPENED", "CLICKED", "BOUNCED", "COMPLAINED", "UNSUBSCRIBED"] },
    },
    orderBy: { occurredAt: "asc" }, distinct: ["messageId", "type"],
    select: { messageId: true, type: true, occurredAt: true },
  });
  return {
    liveSince: activation?.occurredAt.toISOString() || null,
    scope, totals: { joined, sent, waiting, attention },
    rows: rows.map((row) => ({
      id: row.id, triggeredAt: row.createdAt, signupAt: row.occurredAt,
      profile: row.profile && { id: row.profile.id, email: row.profile.email, name: row.profile.name },
      messages: (row.profile?.messages || []).map((message) => ({
        ...message, events: events.filter((event) => event.messageId === message.id)
          .map(({ type, occurredAt }) => ({ type, occurredAt })),
      })),
    })),
    nextCursor: page.length > 25 ? rows[24].id : null,
  };
}

export type WelcomeActivityReport = Awaited<ReturnType<typeof welcomeActivity>>;
