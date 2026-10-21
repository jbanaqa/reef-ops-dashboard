import { cartCheckoutKey } from "./cart";

type OrderSource = {
  checkout_token?: unknown;
  discount_codes?: unknown;
};
type OrderStateSource = { financial_status?: unknown; cancelled_at?: unknown; test?: unknown };
export type OrderState = { financialStatus?: string; cancelledAt?: string | null; test?: boolean };
type StateTimes = Partial<Record<keyof OrderState, string>>;

/** Small lifecycle facts can change without rewriting the original order amount. */
export function compactOrderState(source: OrderStateSource): OrderState {
  return {
    ...(typeof source.financial_status === "string" ? { financialStatus: source.financial_status.toLowerCase().slice(0, 40) } : {}),
    ...(source.cancelled_at === null || typeof source.cancelled_at === "string" ? { cancelledAt: source.cancelled_at } : {}),
    ...(typeof source.test === "boolean" ? { test: source.test } : {}),
  };
}

/** Partial/out-of-order webhooks cannot overwrite newer facts in another field. */
export function orderStateUpdate(existing: unknown, source: OrderStateSource, at: Date): OrderState & { orderStateAt?: StateTimes } {
  const saved = (existing || {}) as { orderStateAt?: StateTimes | string };
  const state = compactOrderState(source);
  const times = typeof saved.orderStateAt === "object" && saved.orderStateAt ? saved.orderStateAt : {};
  const changes: OrderState = {};
  const nextTimes = { ...times };
  for (const key of Object.keys(state) as (keyof OrderState)[]) {
    const previous = new Date(times[key] || (typeof saved.orderStateAt === "string" ? saved.orderStateAt : ""));
    if (Number.isFinite(+previous) && +at < +previous) continue;
    Object.assign(changes, { [key]: state[key] });
    nextTimes[key] = at.toISOString();
  }
  return Object.keys(changes).length ? { ...changes, orderStateAt: nextTimes } : {};
}

/** Welcome conversions require positive known value and no explicit invalidation. */
export function qualifyingOrder(payload: unknown): boolean {
  const source = (payload || {}) as OrderState;
  const { amount, currency } = orderValue(payload);
  return amount !== null && amount > 0 && !!currency && source.test !== true && !source.cancelledAt &&
    !["voided", "refunded"].includes(String(source.financialStatus || "").toLowerCase());
}

export type OrderEvidence = {
  checkoutKey?: string | null;
  discountCodes?: string[];
};

/** Retain small order evidence, never the customer's private recovery token. */
export function compactOrderEvidence(profileId: string, source: OrderSource): OrderEvidence {
  return {
    ...(typeof source.checkout_token === "string" || source.checkout_token === null ? { checkoutKey: source.checkout_token
      ? cartCheckoutKey(profileId, source.checkout_token) : null } : {}),
    ...(Array.isArray(source.discount_codes) || source.discount_codes === null ? { discountCodes: [...new Set(
      (source.discount_codes || []).flatMap(discount => typeof discount?.code === "string" && discount.code.trim()
        ? [discount.code.trim().toUpperCase().slice(0, 255)] : []),
    )].slice(0, 100) } : {}),
  };
}

/** Invalid or unknown order values must not become a zero-valued sale. */
export function orderValue(payload: unknown): { amount: number | null; currency: string | null } {
  const source = (payload || {}) as { revenue?: unknown; currency?: unknown };
  if (typeof source.currency !== "string" || !/^[A-Z]{3}$/.test(source.currency) ||
    !["string", "number"].includes(typeof source.revenue) || String(source.revenue).trim() === "")
    return { amount: null, currency: null };
  const amount = Number(source.revenue);
  return Number.isFinite(amount) && amount >= 0 ? { amount, currency: source.currency } : { amount: null, currency: null };
}
