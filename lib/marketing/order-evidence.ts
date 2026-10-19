import { cartCheckoutKey } from "./cart";

type OrderSource = {
  checkout_token?: unknown;
  discount_codes?: unknown;
};

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
