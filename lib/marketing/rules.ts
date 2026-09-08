export const channels = ["EMAIL", "SMS_MARKETING", "SMS_TRANSACTIONAL"] as const;
export type Channel = typeof channels[number];
export type Content = { heading: string; body: string; button: string; url: string; hero?: string; preview?: string; products?: { title: string; url: string; image?: string; price?: string }[] };
export type Segment = { openedDays?: number; tag?: string; list?: string; purchasedDays?: number; excludePurchasedDays?: number };
export const DAY = 86400000;
export function email(value: unknown) {
  const result = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) || result.length > 254) throw new Error("Enter a valid email address.");
  return result;
}
export function phone(value: unknown) {
  const result = String(value || "").replace(/[ ()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(result)) throw new Error("Use an international phone number, such as +15551234567.");
  return result;
}
export function date(value: unknown) {
  const result = new Date(String(value));
  if (!Number.isFinite(result.getTime())) throw new Error("Invalid date.");
  return result;
}
export function safeUrl(value: unknown) {
  const url = new URL(String(value));
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Links and images must use HTTPS.");
  return url.href;
}
export function content(value: unknown): Content {
  if (!value || typeof value !== "object") throw new Error("Message content is required.");
  const c = value as Content;
  if (!c.heading?.trim() || !c.body?.trim() || c.body.length > 20000) throw new Error("Add a heading and message (up to 20,000 characters).");
  return { heading: c.heading.slice(0, 200), body: c.body, button: String(c.button || "Shop now").slice(0, 80), url: safeUrl(c.url), hero: c.hero ? safeUrl(c.hero) : undefined, preview: String(c.preview || "").slice(0, 200), products: (c.products || []).slice(0, 12).map(p => ({ title: String(p.title).slice(0, 200), url: safeUrl(p.url), image: p.image ? safeUrl(p.image) : undefined, price: String(p.price || "").slice(0, 80) })) };
}
export function segment(value: unknown): Segment {
  const s = (value || {}) as Segment;
  const result: Segment = {};
  for (const key of ["openedDays", "purchasedDays", "excludePurchasedDays"] as const) {
    if (s[key] != null) {
      if (!Number.isInteger(s[key]) || s[key]! < 1 || s[key]! > 3650) throw new Error("Audience windows must be 1–3650 days.");
      result[key] = s[key];
    }
  }
  if (s.tag) result.tag = String(s.tag).toLowerCase().slice(0, 100);
  if (s.list) result.list = String(s.list).slice(0, 100);
  return result;
}
export function eligible(consent: { status: string; suppressed: boolean } | null | undefined) {
  return consent?.status === "SUBSCRIBED" && !consent.suppressed;
}
export function matches(profile: { tags: string[]; lists: string[]; lastOpenedAt: Date | null; lastOrderAt: Date | null }, s: Segment, now = new Date()) {
  const recent = (d: Date | null, days: number) => !!d && d.getTime() >= now.getTime() - days * DAY && d <= now;
  return (!s.openedDays || recent(profile.lastOpenedAt, s.openedDays)) && (!s.tag || profile.tags.includes(s.tag)) && (!s.list || profile.lists.includes(s.list)) && (!s.purchasedDays || recent(profile.lastOrderAt, s.purchasedDays)) && (!s.excludePurchasedDays || !recent(profile.lastOrderAt, s.excludePurchasedDays));
}
export function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }
export function render(c: Content, unsubscribe: string, address: string) {
  const e = escapeHtml;
  return `<!doctype html><html><body style="margin:0;background:#eef5f4;font-family:Arial,sans-serif;color:#123334"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="600" style="max-width:100%;background:white"><tr><td style="padding:28px;text-align:center;background:#083b3b;color:white;font-size:25px;font-weight:bold">CORALS ANONYMOUS</td></tr><tr><td style="display:none">${e(c.preview || "")}</td></tr>${c.hero ? `<tr><td><a href="${e(c.url)}"><img src="${e(c.hero)}" alt="${e(c.heading)}" width="600" style="max-width:100%"></a></td></tr>` : ""}<tr><td style="padding:28px"><h1>${e(c.heading)}</h1><p style="line-height:1.7;white-space:pre-line">${e(c.body)}</p><p><a style="display:inline-block;background:#087f78;padding:16px 24px;color:white" href="${e(c.url)}">${e(c.button)}</a></p>${(c.products || []).map(p => `<div style="display:inline-block;width:48%;vertical-align:top;padding:1%">${p.image ? `<a href="${e(p.url)}"><img alt="${e(p.title)}" src="${e(p.image)}" width="250" style="max-width:100%"></a>` : ""}<p><a href="${e(p.url)}">${e(p.title)}</a></p><p>${e(p.price || "")}</p></div>`).join("")}</td></tr><tr><td style="padding:24px;font-size:12px;text-align:center">Corals Anonymous<br>${e(address)}<br><a href="${e(unsubscribe)}">Unsubscribe from email marketing</a></td></tr></table></td></tr></table></body></html>`;
}
export const defaultContent: Content = { heading: "Discover your next reef favorite", body: "Explore the latest arrivals at Corals Anonymous.", button: "Shop now", url: "https://coralsanonymous.com", preview: "Fresh arrivals for your reef." };
export const flowDefaults = [
  { key: "delivery-upsell", name: "24 Hour Notice | Upsell", trigger: "DELIVERY_SCHEDULED", description: "Schedule 24 hours before a trusted expected-delivery timestamp. Requires delivery-source mapping.", delays: [0] },
  { key: "abandoned-cart", name: "Abandoned Cart", trigger: "CHECKOUT_STARTED", description: "Email sequence with purchase checks before every message; SMS branch at 30 minutes when eligible. Review email delays and copy.", delays: [180, 1440] },
  { key: "b2b-welcome", name: "B2B Welcoming Email", trigger: "B2B_ENTERED", description: "Once per profile on entering Shopify tag b2b. Existing imports do not enroll.", delays: [0] },
  { key: "low-stock", name: "Low Stock Alert: T5", trigger: "LOW_STOCK", description: "Internal SMS for configured recipients when existing inventory state crosses threshold. Confirm threshold and recipients.", delays: [0] },
  { key: "welcome", name: "Welcome Series 08.2025", trigger: "EMAIL_SUBSCRIBED", description: "Once per profile after new email signup; configured first-order coupon in the first message. Review subsequent delays and copy.", delays: [0, 1440, 4320] },
] as const;
