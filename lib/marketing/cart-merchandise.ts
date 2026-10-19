/** Small, immutable checkout facts. Never copy the full webhook into each flow run. */
export type CartMerchandise =
  | { currency: "USD"; subtotalCents: number; merchandiseLines: number }
  | { blocked: typeof CART_NO_MERCHANDISE | typeof CART_MERCHANDISE_UNKNOWN };

export const CART_NO_MERCHANDISE = "Checkout has no merchandise";
export const CART_MERCHANDISE_UNKNOWN = "Checkout merchandise total is unavailable";
const BELOW_MINIMUM = "Checkout merchandise subtotal is below $";
// Verified Corals Anonymous ancillary products; retain exclusion if a title changes.
const SERVICE_PRODUCT_IDS = new Set(["8132094165218", "8216362287330", "9275587821794"]);

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : null;

/** Shopify checkout webhooks use decimal currency amounts, not cart/Liquid cents. */
function cents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function mismatchedMoneyCurrency(value: unknown): boolean {
  const bag = record(value);
  if (!bag) return false;
  return [bag.currency_code, record(bag.shop_money)?.currency_code,
    record(bag.presentment_money)?.currency_code].some(currency => currency !== undefined && currency !== "USD");
}

/** Match ancillary checkout products without excluding products such as boxfish. */
export function isCartServiceLine(value: unknown): boolean {
  const line = record(value);
  if (!line) return false;
  const product = record(line.product);
  if ([line.product_id, line.productId, product?.id,
    typeof line.id === "string" && line.id.startsWith("gid://shopify/Product/") ? line.id : undefined]
    .some(value => SERVICE_PRODUCT_IDS.has(String(value).replace(/^gid:\/\/shopify\/Product\//, "")))) return true;
  return [line.title, line.presentment_title, line.name, line.handle, line.product_type, line.productType,
    product?.title, product?.handle, product?.productType].some(value => {
    if (typeof value !== "string") return false;
    const title = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return /\bshipping\s+(?:box(?:es)?|protection|insurance)\b/.test(title) ||
      /\b(?:package|order|checkout)\s+protection\b/.test(title) ||
      /^(?:protection|shipping box(?:es)?)$/.test(title);
  });
}

/**
 * Checkout subtotal is after discounts and before shipping/taxes/tips. Sum actual
 * line prices, remove the ancillary products, and reconcile against that subtotal.
 * Any discount not allocated to a line is charged entirely against merchandise:
 * this is a conservative lower bound, never an invented pro-rata allocation.
 * https://shopify.dev/docs/api/admin-rest/2026-07/resources/webhook
 * https://shopify.dev/docs/api/admin-graphql/latest/objects/AbandonedCheckout
 */
export function cartMerchandise(value: unknown): CartMerchandise {
  const unknown = (): CartMerchandise => ({ blocked: CART_MERCHANDISE_UNKNOWN });
  const checkout = record(value);
  if (!checkout || !Array.isArray(checkout.line_items)) return unknown();
  const lines: { line: RecordValue; quantity: number; service: boolean }[] = [];
  for (const value of checkout.line_items) {
    const line = record(value);
    if (!line || !Number.isSafeInteger(line.quantity) || (line.quantity as number) < 0) return unknown();
    if (line.quantity === 0) continue;
    lines.push({ line, quantity: line.quantity as number, service: isCartServiceLine(line) });
  }
  const merchandiseLines = lines.filter(line => !line.service).length;
  // Service-only carts are excluded even when their amounts/currency are absent.
  if (!merchandiseLines) return { blocked: CART_NO_MERCHANDISE };
  if (checkout.currency !== "USD" ||
    (checkout.presentment_currency !== undefined && checkout.presentment_currency !== null && checkout.presentment_currency !== "USD") ||
    checkout.taxes_included === true || mismatchedMoneyCurrency(checkout.subtotal_price_set)) return unknown();
  const subtotal = cents(checkout.subtotal_price);
  if (subtotal === null) return unknown();
  let allNet = 0, merchandiseNet = 0;
  for (const { line, quantity, service } of lines) {
    // A missing title must not let an unidentified shipping/protection product count.
    if (!service && ![line.title, line.presentment_title, line.name].some(value => typeof value === "string" && value.trim())) return unknown();
    if ((line.currency !== undefined && line.currency !== "USD") || mismatchedMoneyCurrency(line.price_set)) return unknown();
    const unit = cents(line.price);
    if (unit === null || !Number.isSafeInteger(unit * quantity)) return unknown();
    const gross = unit * quantity;
    let discount = 0;
    if (line.discount_allocations !== undefined && !Array.isArray(line.discount_allocations)) return unknown();
    if (Array.isArray(line.discount_allocations) && line.discount_allocations.length) {
      for (const value of line.discount_allocations) {
        const allocation = record(value), amount = cents(allocation?.amount);
        if (amount === null || (allocation?.currency !== undefined && allocation.currency !== "USD") ||
          mismatchedMoneyCurrency(allocation?.amount_set)) return unknown();
        discount += amount;
        if (!Number.isSafeInteger(discount)) return unknown();
      }
    } else if (line.total_discount !== undefined) {
      const amount = cents(line.total_discount);
      if (amount === null) return unknown();
      discount = amount;
    }
    if (discount > gross) return unknown();
    allNet += gross - discount;
    if (!service) merchandiseNet += gross - discount;
    if (!Number.isSafeInteger(allNet) || !Number.isSafeInteger(merchandiseNet)) return unknown();
  }
  if (subtotal > allNet) return unknown();
  return { currency: "USD", subtotalCents: Math.max(0, merchandiseNet - (allNet - subtotal)), merchandiseLines };
}

/** Apply today's rule to saved facts, including runs enrolled before the rule existed. */
export function cartMerchandiseBlock(value: unknown, minimumCents = 10000): string | null {
  const facts = record(value);
  if (facts?.blocked === CART_NO_MERCHANDISE) return CART_NO_MERCHANDISE;
  if (!facts || "blocked" in facts || facts.currency !== "USD" || !Number.isSafeInteger(facts.subtotalCents) ||
    (facts.subtotalCents as number) < 0 || !Number.isSafeInteger(facts.merchandiseLines) ||
    (facts.merchandiseLines as number) < 1 || !Number.isSafeInteger(minimumCents) || minimumCents < 0) return CART_MERCHANDISE_UNKNOWN;
  return (facts.subtotalCents as number) < minimumCents
    ? `${BELOW_MINIMUM}${(minimumCents / 100).toFixed(2)} USD` : null;
}

export function isCartMerchandiseBlock(reason: string): boolean {
  return reason === CART_NO_MERCHANDISE || reason === CART_MERCHANDISE_UNKNOWN || reason.startsWith(BELOW_MINIMUM);
}
