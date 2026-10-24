import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { shop, type Tx } from "./store";
import { shopifyGraphql } from "./shopify";
import { orderStateUpdate } from "./order-evidence";

export type OrderPaymentSnapshot = {
  amount: string;
  currency: string;
  sourceUpdatedAt: string;
  checkedAt: string;
};
type Client = Pick<Tx, "$queryRaw">;
type OrderRow = { id: string; payload: unknown };
type State = {
  id: string; orderId: string | null; payment: unknown; paymentDirtyAt: string | null;
  paymentCheckAt: string | null; paymentCheckedFor: string | null; paymentError: string | null;
  financialStatus: string | null; cancelledAt: string | null; hasCancelledAt: boolean; test: boolean | null; orderStateAt: unknown;
};
type Lookup = { orderId: string; payment: OrderPaymentSnapshot | null; checkedAt: string; checkedFor: string | null; error?: string;
  sourceUpdatedAt?: string; state?: { financial_status?: string; cancelled_at?: string | null; test?: boolean } };
type Pending = { promise: Promise<Lookup>; users: number };
const TTL = 5 * 60000;
const inFlight = new Map<string, Pending>();
const queues = new Map<string, Promise<unknown>>();
const unavailable = new Map<string, { until: number; error: string }>();
const query = `query MarketingOrderPayments($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Order { id updatedAt netPaymentSet { shopMoney { amount currencyCode } } displayFinancialStatus cancelledAt test } }
}`;
const columns = Prisma.sql`id, payload->>'orderId' AS "orderId", payload->'payment' AS payment,
  payload->>'paymentDirtyAt' AS "paymentDirtyAt", payload->>'paymentCheckAt' AS "paymentCheckAt",
  payload->>'paymentCheckedFor' AS "paymentCheckedFor", payload->>'paymentError' AS "paymentError",
  payload->>'financialStatus' AS "financialStatus", payload->>'cancelledAt' AS "cancelledAt", (payload ? 'cancelledAt') AS "hasCancelledAt",
  payload->'test' AS test, payload->'orderStateAt' AS "orderStateAt"`;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const time = (value: unknown) => typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const orderId = (value: unknown) => {
  const id = String(value || "").replace(/^gid:\/\/shopify\/Order\//, "");
  return /^\d+$/.test(id) && BigInt(id) > BigInt(0) ? BigInt(id).toString() : null;
};

/** Net receipts can be zero or negative after refunds. Callers decide whether they are a positive conversion. */
export function normalizedOrderPayment(value: unknown, now = Date.now()): OrderPaymentSnapshot | null {
  const v = record(value), checkedAt = time(v.checkedAt), sourceUpdatedAt = time(v.sourceUpdatedAt);
  if (typeof v.amount !== "string" || !/^-?\d+(?:\.\d+)?$/.test(v.amount) || !Number.isFinite(Number(v.amount)) ||
      typeof v.currency !== "string" || !/^[A-Z]{3}$/.test(v.currency) || checkedAt === null || sourceUpdatedAt === null ||
      checkedAt > now + 300000 || sourceUpdatedAt > checkedAt + 300000) return null;
  return { amount: v.amount, currency: v.currency, sourceUpdatedAt: new Date(sourceUpdatedAt).toISOString(), checkedAt: new Date(checkedAt).toISOString() };
}

function currentPayment(state: State, now = Date.now()) {
  const payment = normalizedOrderPayment(state.payment, now);
  return payment && now - Date.parse(payment.checkedAt) < TTL &&
    (time(state.paymentDirtyAt) === null || Date.parse(payment.sourceUpdatedAt) >= time(state.paymentDirtyAt)!) ? payment : null;
}

function backedOff(state: State, now = Date.now()) {
  const checked = time(state.paymentCheckAt), dirty = time(state.paymentDirtyAt), checkedFor = time(state.paymentCheckedFor);
  return checked !== null && checked <= now + 300000 && now - checked < TTL && (dirty === null || (checkedFor !== null && dirty <= checkedFor));
}

/** Webhook clocks stay separate from lifecycle and original purchase-time facts. */
export function orderPaymentDirtyUpdate(existing: unknown, at: Date) {
  const previous = time(record(existing).paymentDirtyAt);
  return Number.isFinite(+at) && (previous === null || +at > previous) ? { paymentDirtyAt: at.toISOString() } : {};
}

async function states(client: Client, ids: string[]) {
  if (!ids.length) return [];
  return client.$queryRaw<State[]>(Prisma.sql`SELECT ${columns} FROM "MarketingEvent"
    WHERE shop=${shop()} AND type='ORDER' AND id IN (${Prisma.join(ids)})`);
}

async function readBatch(requests: { orderId: string; checkedFor: string | null }[]): Promise<Map<string, Lookup>> {
  const tenant = shop(), previousFailure = unavailable.get(tenant);
  const failed = (message: string) => new Map(requests.map(item => [item.orderId, {
    ...item, payment: null, checkedAt: new Date().toISOString(), error: message.slice(0, 300),
  }]));
  if (previousFailure && previousFailure.until > Date.now()) return failed(previousFailure.error);
  try {
    const result = await shopifyGraphql<{ data?: { nodes?: ({ id?: unknown; updatedAt?: unknown; netPaymentSet?: { shopMoney?: { amount?: unknown; currencyCode?: unknown } };
      displayFinancialStatus?: unknown; cancelledAt?: unknown; test?: unknown } | null)[] } }>(
      query, { ids: requests.map(item => `gid://shopify/Order/${item.orderId}`) });
    if (!Array.isArray(result.data?.nodes)) throw Error("Shopify did not return order payment data.");
    unavailable.delete(tenant);
    const checkedAt = new Date().toISOString();
    return new Map(requests.map(item => {
      const node = result.data!.nodes!.find(node => node && orderId(node.id) === item.orderId);
      const payment = node ? normalizedOrderPayment({ amount: node.netPaymentSet?.shopMoney?.amount,
        currency: node.netPaymentSet?.shopMoney?.currencyCode, sourceUpdatedAt: node.updatedAt, checkedAt }) : null;
      const valid = payment && (time(item.checkedFor) === null || Date.parse(payment.sourceUpdatedAt) >= time(item.checkedFor)!);
      return [item.orderId, { ...item, payment: valid ? payment : null, checkedAt,
        ...(time(node?.updatedAt) !== null ? { sourceUpdatedAt: new Date(time(node?.updatedAt)!).toISOString() } : {}),
        ...(node ? { state: {
          ...(typeof node.displayFinancialStatus === "string" ? { financial_status: node.displayFinancialStatus.toLowerCase() } : {}),
          ...(node.cancelledAt === null || typeof node.cancelledAt === "string" ? { cancelled_at: node.cancelledAt } : {}),
          ...(typeof node.test === "boolean" ? { test: node.test } : {}),
        } } : {}),
        ...(!valid ? { error: !node ? "Shopify order is unavailable or outside this connection's access." : payment
          ? "Shopify payment data predates the latest recorded order update." : "Shopify order payment data is incomplete or invalid." } : {}) }];
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify order payments are temporarily unavailable.";
    unavailable.set(tenant, { until: Date.now() + TTL, error: message.slice(0, 300) });
    return failed(message);
  }
}

function acquire(requests: { orderId: string; checkedFor: string | null }[]) {
  const tenant = shop(), entries = new Map<string, { key: string; pending: Pending }>();
  const missing = requests.filter(item => !inFlight.has(`${tenant}:${item.orderId}:${item.checkedFor || ""}`));
  for (let offset = 0; offset < missing.length; offset += 100) {
    const batch = missing.slice(offset, offset + 100);
    const lookup = (queues.get(tenant) || Promise.resolve()).then(() => readBatch(batch));
    queues.set(tenant, lookup.catch(() => undefined));
    for (const item of batch) inFlight.set(`${tenant}:${item.orderId}:${item.checkedFor || ""}`, {
      users: 0, promise: lookup.then(result => result.get(item.orderId)!),
    });
  }
  for (const item of requests) {
    const key = `${tenant}:${item.orderId}:${item.checkedFor || ""}`, pending = inFlight.get(key)!;
    pending.users++; entries.set(item.orderId, { key, pending });
  }
  return entries;
}

async function savePayment(client: Client, original: State, lookup: Lookup): Promise<State> {
  let state = original;
  for (let attempt = 0; attempt < 4; attempt++) {
    const saved = normalizedOrderPayment(state.payment), received = lookup.payment;
    if (orderId(state.orderId) !== lookup.orderId) return state;
    // Another report may already have persisted a newer authoritative observation.
    if (saved && currentPayment(state) && (!received || Date.parse(saved.sourceUpdatedAt) > Date.parse(received.sourceUpdatedAt) ||
      (saved.sourceUpdatedAt === received.sourceUpdatedAt && Date.parse(saved.checkedAt) >= Date.parse(received.checkedAt)))) return state;
    if (time(state.paymentCheckAt) !== null && time(state.paymentCheckAt)! > Date.parse(lookup.checkedAt)) return state;
    const older = !!saved && time(lookup.sourceUpdatedAt) !== null && Date.parse(saved.sourceUpdatedAt) > time(lookup.sourceUpdatedAt)!;
    const dirty = time(state.paymentDirtyAt), payment = !older && received && (dirty === null || Date.parse(received.sourceUpdatedAt) >= dirty) ? received : null;
    const lifecycle = payment && lookup.state ? orderStateUpdate({ orderStateAt: state.orderStateAt }, lookup.state, new Date(payment.sourceUpdatedAt)) : {};
    // Keep the last authoritative version even when it is too stale to report. A failed
    // refresh must not erase the watermark and let an older replica replace it later.
    const patch = payment ? { payment, ...lifecycle } : { payment: saved, paymentCheckAt: lookup.checkedAt, paymentCheckedFor: lookup.checkedFor,
      paymentError: lookup.error || (older ? "Shopify payment data is older than a saved payment observation." : "Shopify payment data predates a newer recorded order update.") };
    const updated = await client.$queryRaw<State[]>(Prisma.sql`UPDATE "MarketingEvent"
      SET payload=((payload - 'paymentCheckAt' - 'paymentCheckedFor' - 'paymentError') || ${JSON.stringify(patch)}::jsonb)
      WHERE id=${state.id} AND shop=${shop()} AND type='ORDER'
        AND (payload->>'orderId') IS NOT DISTINCT FROM ${state.orderId}
        AND COALESCE(payload->'payment', 'null'::jsonb)=${JSON.stringify(state.payment ?? null)}::jsonb
        AND (payload->>'paymentDirtyAt') IS NOT DISTINCT FROM ${state.paymentDirtyAt}
        AND (payload->>'paymentCheckAt') IS NOT DISTINCT FROM ${state.paymentCheckAt}
        AND (payload->>'paymentCheckedFor') IS NOT DISTINCT FROM ${state.paymentCheckedFor}
        AND COALESCE(payload->'orderStateAt', 'null'::jsonb)=${JSON.stringify(state.orderStateAt ?? null)}::jsonb
      RETURNING ${columns}`);
    if (updated[0]) return updated[0];
    const latest = (await states(client, [state.id]))[0];
    if (!latest) return { ...state, payment: null };
    state = latest;
  }
  return state;
}

/** Enrich only compact recorded ORDER rows; no recipient, message or original order fact is changed. */
export async function ensureOrderPayments<T extends OrderRow>(client: Client, orders: T[], options: { refresh?: boolean } = {}): Promise<T[]> {
  if (!orders.length) return orders;
  const saved = new Map((await states(client, [...new Set(orders.map(item => item.id))])).map(state => [state.id, state]));
  const requests = new Map<string, { orderId: string; checkedFor: string | null }>();
  if (options.refresh !== false) for (const state of saved.values()) {
    const id = orderId(state.orderId);
    if (!id || currentPayment(state) || backedOff(state)) continue;
    const previous = requests.get(id), dirty = time(state.paymentDirtyAt);
    if (!previous || (dirty !== null && dirty > (time(previous.checkedFor) ?? -Infinity))) requests.set(id, { orderId: id, checkedFor: state.paymentDirtyAt });
  }
  const pending = acquire([...requests.values()]);
  try {
    for (const state of saved.values()) {
      const entry = pending.get(orderId(state.orderId) || "");
      if (entry && !currentPayment(state) && !backedOff(state)) saved.set(state.id, await savePayment(client, state, await entry.pending.promise));
    }
    return orders.map(order => {
      const state = saved.get(order.id), payment = state ? currentPayment(state) : null;
      return { ...order, payload: { ...record(order.payload), payment,
        ...(state ? { paymentDirtyAt: state.paymentDirtyAt, paymentCheckAt: state.paymentCheckAt, paymentError: payment ? null : state.paymentError,
          ...(state.financialStatus !== null ? { financialStatus: state.financialStatus } : {}),
          ...(state.hasCancelledAt ? { cancelledAt: state.cancelledAt } : {}),
          ...(typeof state.test === "boolean" ? { test: state.test } : {}),
          ...(state.orderStateAt !== null ? { orderStateAt: state.orderStateAt } : {}),
        } : {}) } };
    });
  } finally {
    for (const { key, pending: entry } of pending.values()) if (--entry.users === 0) inFlight.delete(key);
  }
}

/** Small background sweep; reports also refresh their own order pages on demand. */
export async function refreshOrderPayments(limit = 100) {
  const take = Math.min(100, Math.max(1, Math.floor(limit))), now = new Date(), cutoff = new Date(+now - TTL).toISOString();
  const orders = await prisma.$queryRaw<OrderRow[]>(Prisma.sql`SELECT id, jsonb_build_object('orderId', payload->'orderId') AS payload
    FROM "MarketingEvent" WHERE shop=${shop()} AND type='ORDER' AND "occurredAt">=${new Date(+now - 365 * 86400000)}
      AND COALESCE(payload->>'orderId', '') ~ '^(gid://shopify/Order/)?[0-9]+$'
      AND (payload->'payment'->>'checkedAt' IS NULL OR payload->'payment'->>'checkedAt'<=${cutoff}
        OR COALESCE(payload->>'paymentDirtyAt', '')>COALESCE(payload->'payment'->>'sourceUpdatedAt', ''))
      AND (payload->>'paymentCheckAt' IS NULL OR payload->>'paymentCheckAt'<=${cutoff}
        OR COALESCE(payload->>'paymentDirtyAt', '')>COALESCE(payload->>'paymentCheckedFor', ''))
    ORDER BY COALESCE(payload->'payment'->>'checkedAt', payload->>'paymentCheckAt', ''), id LIMIT ${take}`);
  const hydrated = await ensureOrderPayments(prisma, orders);
  return { checked: hydrated.length, verified: hydrated.filter(row => record(row.payload).payment !== null).length,
    unavailable: hydrated.filter(row => record(row.payload).payment === null).length };
}
