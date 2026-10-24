import { Prisma } from "@/app/generated/prisma/client";
import { compactOrderEvidence, compactOrderState, orderValue, qualifyingOrder, type OrderEvidence, type OrderState } from "./order-evidence";
import { ensureOrderPayments } from "./order-payments";
import { shop, type Tx } from "./store";

type Client = Pick<Tx, "marketingEvent" | "marketingResource" | "$queryRaw">;
export type WelcomeOrderPayload = OrderEvidence & OrderState & {
  orderId?: unknown; revenue?: unknown; currency?: unknown; payment?: unknown; paymentStale?: boolean;
};
export type WelcomeAttributionMessage = {
  id: string; flowKey: string | null; flowStep: number | null;
  triggerAt: Date | null; sentAt: Date | null;
};
type Source = {
  orderId: string; codes: unknown; financialStatus: string | null;
  cancelledAt: string | null; hasCancelledAt: boolean; test: boolean | null;
};

const canonicalOrderId = (value: unknown): string | null => {
  const id = String(value || "").replace(/^gid:\/\/shopify\/Order\//, "");
  return /^\d+$/.test(id) ? BigInt(id).toString() : null;
};
export const orderPaymentIdentity = (orderId: unknown, eventId: string) => {
  const id = canonicalOrderId(orderId);
  return id ? "order:" + id : "event:" + eventId;
};
const timestamp = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(+date) ? date : null;
};

/** Read only missing small facts from retained Shopify events, never full orders. */
async function withSourceFacts<T extends WelcomeOrderPayload>(client: Client, profileId: string, payloads: T[]): Promise<T[]> {
  const ids = [...new Set(payloads.filter(payload => payload.discountCodes === undefined || payload.financialStatus === undefined ||
    payload.cancelledAt === undefined || payload.test === undefined).flatMap(payload => canonicalOrderId(payload.orderId) || []))];
  const sources = new Map<string, Source>();
  for (let index = 0; index < ids.length; index += 100) {
    const page = await client.$queryRaw<Source[]>(Prisma.sql`
      SELECT "payload"->>'id' AS "orderId",
        (ARRAY_AGG("payload"->'discount_codes' ORDER BY "occurredAt" DESC, id DESC)
          FILTER (WHERE jsonb_typeof("payload"->'discount_codes') = 'array'))[1] AS codes,
        (ARRAY_AGG("payload"->>'financial_status' ORDER BY "occurredAt" DESC, id DESC)
          FILTER (WHERE jsonb_typeof("payload"->'financial_status') = 'string'))[1] AS "financialStatus",
        (ARRAY_AGG("payload"->>'cancelled_at' ORDER BY "occurredAt" DESC, id DESC)
          FILTER (WHERE "payload" ? 'cancelled_at'))[1] AS "cancelledAt",
        BOOL_OR("payload" ? 'cancelled_at') AS "hasCancelledAt",
        (ARRAY_AGG(("payload"->>'test')::boolean ORDER BY "occurredAt" DESC, id DESC)
          FILTER (WHERE jsonb_typeof("payload"->'test') = 'boolean'))[1] AS test
      FROM "MarketingEvent" WHERE shop=${shop()} AND type IN ('orders/create', 'orders/updated')
        AND "payload"->>'id' IN (${Prisma.join(ids.slice(index, index + 100))})
      GROUP BY "payload"->>'id'`);
    for (const source of page) sources.set(source.orderId, source);
  }
  return payloads.map(payload => {
    const source = sources.get(canonicalOrderId(payload.orderId) || "");
    if (!source) return payload;
    const evidence = compactOrderEvidence(profileId, { ...(Array.isArray(source.codes) ? { discount_codes: source.codes } : {}) });
    const state = compactOrderState({
      ...(source.financialStatus !== null ? { financial_status: source.financialStatus } : {}),
      ...(source.hasCancelledAt ? { cancelled_at: source.cancelledAt } : {}),
      ...(typeof source.test === "boolean" ? { test: source.test } : {}),
    });
    return {
      ...payload,
      ...(payload.discountCodes === undefined ? evidence : {}),
      ...(payload.financialStatus === undefined && state.financialStatus !== undefined ? { financialStatus: state.financialStatus } : {}),
      ...(payload.cancelledAt === undefined && state.cancelledAt !== undefined ? { cancelledAt: state.cancelledAt } : {}),
      ...(payload.test === undefined && state.test !== undefined ? { test: state.test } : {}),
    };
  });
}

export async function welcomeOrderPayload<T extends WelcomeOrderPayload>(client: Client, profileId: string, payload: T): Promise<T> {
  return (await withSourceFacts(client, profileId, [payload]))[0];
}

/** Earlier qualifying orders consume the first-order opportunity even outside the displayed period. */
async function isFirstOrder(client: Client, profileId: string, enteredAt: Date, convertedAt: Date, order: WelcomeOrderPayload, unverifiedOrderIds?: Set<string>, staleOrderIds?: Set<string>) {
  const currentId = canonicalOrderId(order.orderId);
  let cursor: { at: Date; id: string } | undefined;
  for (;;) {
    const page = await client.$queryRaw<{ id: string; occurredAt: Date; payload: WelcomeOrderPayload }[]>(Prisma.sql`
      SELECT source.id, source."occurredAt",
        (SELECT COALESCE(jsonb_object_agg(field.key, field.value), '{}'::jsonb)
          FROM jsonb_each(CASE WHEN jsonb_typeof(source.payload) = 'object' THEN source.payload ELSE '{}'::jsonb END) AS field
          WHERE field.key IN ('orderId', 'revenue', 'currency', 'discountCodes', 'financialStatus', 'cancelledAt', 'test',
            'payment', 'paymentDirtyAt', 'paymentCheckAt', 'paymentError')) AS payload
      FROM "MarketingEvent" AS source
      WHERE source.shop=${shop()} AND source."profileId"=${profileId} AND source.type='ORDER'
        AND source."occurredAt">=${enteredAt} AND source."occurredAt"<=${convertedAt}
        ${cursor ? Prisma.sql`AND (source."occurredAt", source.id)>(${cursor.at}, ${cursor.id})` : Prisma.empty}
      ORDER BY source."occurredAt" ASC, source.id ASC LIMIT 100`);
    if (!page.length) return true;
    const paidOrders = await ensureOrderPayments(client, page);
    const payloads = await withSourceFacts(client, profileId, paidOrders.map(row => row.payload));
    for (let index = 0; index < page.length; index++) {
      const prior = page[index], payload = payloads[index], priorId = canonicalOrderId(payload.orderId);
      if (currentId && priorId === currentId) continue;
      const earlier = prior.occurredAt < convertedAt || !currentId || !priorId || BigInt(priorId) < BigInt(currentId);
      if (!earlier) continue;
      if (payload.test === true || payload.cancelledAt || ["voided", "refunded"].includes(String(payload.financialStatus || "").toLowerCase())) continue;
      // An unknown earlier payment cannot manufacture a later "first" purchase.
      if (orderValue(payload).amount === null) {
        unverifiedOrderIds?.add(orderPaymentIdentity(payload.orderId, prior.id));
        return false;
      }
      if (payload.paymentStale === true) staleOrderIds?.add(orderPaymentIdentity(payload.orderId, prior.id));
      if (!qualifyingOrder(payload)) continue;
      if (prior.occurredAt < convertedAt) return false;
      // Shopify order IDs give stable chronology when orders share a timestamp.
      if (!currentId || !priorId || BigInt(priorId) < BigInt(currentId)) return false;
    }
    if (page.length < 100) return true;
    cursor = { at: page[page.length - 1].occurredAt, id: page[page.length - 1].id };
  }
}

export async function welcomeAttributionFacts(
  client: Client, profileId: string, convertedAt: Date,
  messages: WelcomeAttributionMessage[], order?: WelcomeOrderPayload, unverifiedOrderIds?: Set<string>, staleOrderIds?: Set<string>,
) {
  const welcome = messages.filter(message => message.flowKey === "welcome" && message.sentAt && message.sentAt <= convertedAt);
  const empty = { enteredAt: null as Date | null, firstOrder: false, eligibleMessageIds: new Set<string>(),
    couponMatch: null as { messageId: string; code: string; sentAt: Date } | null };
  if (!welcome.length) return empty;
  // Without an order there is no first-purchase or redemption evidence.
  if (!order) return empty;
  const payload = await welcomeOrderPayload(client, profileId, order);
  if (!qualifyingOrder(payload)) return empty;
  const [resources, enrollment] = await Promise.all([
    client.$queryRaw<{ kind: string; enteredAt: string | null; code: string | null; startsAt: string | null; endsAt: string | null }[]>(Prisma.sql`
      SELECT kind, data->>'enteredAt' AS "enteredAt", data->>'code' AS code,
        data->>'startsAt' AS "startsAt", data->>'endsAt' AS "endsAt"
      FROM "MarketingResource" WHERE shop=${shop()} AND key=${profileId} AND kind IN ('WELCOME_RUN', 'WELCOME_COUPON')`),
    client.marketingEvent.findFirst({ where: { shop: shop(), profileId, type: "WELCOME_ENTERED",
      OR: [{ NOT: { payload: { path: ["test"], equals: true } } }, { payload: { path: ["test"], equals: Prisma.DbNull } }],
    }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], select: { occurredAt: true } }),
  ]);
  const run = resources.find(resource => resource.kind === "WELCOME_RUN");
  const triggers = welcome.flatMap(message => message.triggerAt && Number.isFinite(+message.triggerAt) ? [message.triggerAt] : [])
    .sort((a, b) => +a - +b);
  const enteredAt = timestamp(run?.enteredAt) || enrollment?.occurredAt || triggers[0] || null;
  if (enteredAt && convertedAt < enteredAt) return { ...empty, enteredAt };
  const firstOrder = !!enteredAt && await isFirstOrder(client, profileId, enteredAt, convertedAt, payload, unverifiedOrderIds, staleOrderIds);
  const coupon = resources.find(resource => resource.kind === "WELCOME_COUPON");
  const used = new Set((Array.isArray(payload.discountCodes) ? payload.discountCodes : [])
    .filter(code => typeof code === "string").map(code => code.trim().toUpperCase()));
  const code = typeof coupon?.code === "string" ? coupon.code.trim().toUpperCase() : "";
  const startsAt = timestamp(coupon?.startsAt), endsAt = timestamp(coupon?.endsAt);
  const validDates = (!coupon?.startsAt || (!!startsAt && startsAt <= convertedAt)) &&
    (!coupon?.endsAt || (!!endsAt && convertedAt < endsAt));
  const offer = code && used.has(code) && validDates ? welcome.filter(message => (message.flowStep ?? 0) < 3 &&
    (!startsAt || message.sentAt! >= startsAt))
    .sort((a, b) => +b.sentAt! - +a.sentAt! || b.id.localeCompare(a.id))[0] : undefined;
  const couponMatch = offer ? { messageId: offer.id, code, sentAt: offer.sentAt! } : null;
  return { enteredAt, firstOrder,
    eligibleMessageIds: new Set(firstOrder || couponMatch ? welcome.map(message => message.id) : []), couponMatch };
}
