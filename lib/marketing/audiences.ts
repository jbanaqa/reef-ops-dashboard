import { flowProgress } from "./flow-progress";
import { cartTestSendState } from "./cart-test";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { audienceWhere, shop } from "./store";
import { segment } from "./rules";

/** Staff contact browsing includes non-subscribers; saved audiences retain sending eligibility rules. */
export async function audienceDirectory(url: URL) {
  const query = (url.searchParams.get("q") || "").trim().slice(0, 254);
  const status = url.searchParams.get("status") || "all";
  if (
    ![
      "all",
      "subscribed",
      "unsubscribed",
      "blocked",
      "not-subscribed",
    ].includes(status)
  )
    throw new Error("Choose a valid email status.");
  const groups = await prisma.marketingResource.findMany({
    where: { shop: shop(), kind: "SEGMENT" },
    orderBy: { name: "asc" },
    take: 200,
  });
  const groupKey = url.searchParams.get("group");
  const group = groupKey ? groups.find((g) => g.key === groupKey) : null;
  if (groupKey && !group)
    throw new Error("This saved audience is no longer available.");
  const and: Prisma.MarketingProfileWhereInput[] = [{ shop: shop() }];
  if (group) and.push(audienceWhere(segment(group.data)));
  if (query)
    and.push({
      OR: ["email", "name", "phone"].map((field) => ({
        [field]: { contains: query, mode: "insensitive" },
      })),
    });
  if (url.searchParams.get("b2b") === "true")
    and.push({ tags: { has: "b2b" } });
  if (status === "subscribed")
    and.push({
      email: { not: null },
      consents: {
        some: { channel: "EMAIL", status: "SUBSCRIBED", suppressed: false },
      },
    });
  if (status === "unsubscribed")
    and.push({
      consents: { some: { channel: "EMAIL", status: "UNSUBSCRIBED" } },
    });
  if (status === "blocked")
    and.push({ consents: { some: { channel: "EMAIL", suppressed: true } } });
  if (status === "not-subscribed")
    and.push({
      OR: [
        { consents: { none: { channel: "EMAIL" } } },
        {
          consents: {
            some: {
              channel: "EMAIL",
              status: "NEVER_SUBSCRIBED",
              suppressed: false,
            },
          },
        },
      ],
    });
  const where: Prisma.MarketingProfileWhereInput = { AND: and };
  const cursor = url.searchParams.get("cursor");
  if (
    cursor &&
    !(await prisma.marketingProfile.findFirst({
      where: { id: cursor, shop: shop() },
      select: { id: true },
    }))
  )
    throw new Error(
      "This page is no longer available. Return to the first page.",
    );
  const [rows, total] = await Promise.all([
    prisma.marketingProfile.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 26,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        tags: true,
        lists: true,
        createdAt: true,
        lastOpenedAt: true,
        lastOrderAt: true,
        consents: true,
      },
    }),
    prisma.marketingProfile.count({ where }),
  ]);
  return {
    profiles: rows.slice(0, 25),
    total,
    nextCursor: rows.length > 25 ? rows[24].id : null,
    groups: groups.map(({ id, key, name, data }) => ({ id, key, name, data })),
  };
}

/** Keep uploaded email artwork, unsubscribe tokens, and raw Shopify payloads out of the staff panel response. */
export async function contactDetails(id: string) {
  const profile = await prisma.marketingProfile.findFirst({
    where: { id, shop: shop() },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      tags: true,
      lists: true,
      createdAt: true,
      lastOpenedAt: true,
      lastOrderAt: true,
      consents: {
        select: {
          channel: true,
          status: true,
          suppressed: true,
          source: true,
          occurredAt: true,
          reason: true,
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          subject: true,
          status: true,
          channel: true,
          flowKey: true,
          key: true,
          attempts: true,
          flowCondition: true,
          dueAt: true,
          createdAt: true,
          sentAt: true,
          error: true,
        },
      },
      events: {
        orderBy: { occurredAt: "desc" },
        take: 100,
        select: { id: true, type: true, occurredAt: true, payload: true },
      },
    },
  });
  if (!profile) return null;
  const [activeMessages, flows] = await Promise.all([
    prisma.marketingMessage.findMany({
      where: {
        profileId: profile.id,
        shop: shop(),
        flowKey: { not: null },
        status: { in: ["PENDING", "SENDING", "UNKNOWN"] },
      },
      take: 501,
      orderBy: { dueAt: "asc" },
      select: {
        id: true,
        key: true,
        flowKey: true,
        flowCondition: true,
        subject: true,
        status: true,
        dueAt: true,
        createdAt: true,
        sentAt: true,
        error: true,
      },
    }),
    prisma.marketingResource.findMany({
      where: { shop: shop(), kind: "FLOW" },
      select: { key: true, name: true, enabled: true },
    }),
  ]);
  const progressMessages = [
    ...new Map(
      [...profile.messages, ...activeMessages.slice(0, 500)].map((m) => [
        m.id,
        m,
      ]),
    ).values(),
  ];
  return {
    ...profile,
    flowProgress: flowProgress(progressMessages, flows),
    flowProgressLimited:
      activeMessages.length > 500 || profile.messages.length === 100,
    messages: await Promise.all(
      profile.messages.map(async (m) => {
        const testSend = await cartTestSendState(prisma, m, profile.email);
        const { key, attempts, flowCondition, ...publicMessage } = m;
        void key;
        void attempts;
        void flowCondition;
        return { ...publicMessage, ...(testSend ? { testSend } : {}) };
      }),
    ),
    events: profile.events.map((event) => {
      const payload =
        event.payload &&
        typeof event.payload === "object" &&
        !Array.isArray(event.payload)
          ? event.payload
          : {};
      return {
        ...event,
        payload: Object.fromEntries(
          Object.entries(payload).filter(([key]) =>
            ["channel", "status", "ignored", "tags"].includes(key),
          ),
        ),
      };
    }),
  };
}
