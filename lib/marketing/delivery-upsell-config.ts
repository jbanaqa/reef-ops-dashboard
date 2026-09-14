import { email, type Content } from "./rules";
import type { FlowConfig } from "./flow-config";

export type DeliveryUpsellConfig = {
  version: 1;
  daysBefore: number;
  sendHour: number;
  timezone: string;
  testEmail?: string;
  bypassRecentEmailSuppression?: boolean;
};

export const defaultDeliveryUpsell: DeliveryUpsellConfig = {
  version: 1,
  daysBefore: 2,
  sendHour: 8,
  timezone: "America/Los_Angeles",
};

export const deliveryUpsellContent: Content = {
  template: "b2b-wholesale",
  heading: "Corals, you have 24 hours to add-on to your order.",
  body: [
    "Your order is shipping out tomorrow at 8AM PST!",
    "",
    "If you'd like to add any extra corals, we can include them with no extra shipping cost before we close up your box.",
    "",
    "*Box Fee & Shipping Cost will be automatically refunded after purchase.",
  ].join("\n"),
  bodyHtml:
    '<p style="text-align:center"><strong>Your order is shipping out tomorrow at 8AM PST!</strong></p>' +
    '<p style="text-align:center">If you\'d like to add any extra corals, we can include them with <strong>no extra shipping cost*</strong> before we close up your box.</p>' +
    '<p style="text-align:center;font-size:12px"><strong>*Box Fee &amp; Shipping Cost will be automatically refunded after purchase.</strong></p>',
  button: "Grab More Corals Now!",
  url: "https://coralsanonymous.com/collections/new-arrivals",
  preview: "No Extra Shipping—Add More Corals and CUC Critters Today!",
  footerTitle: "Thank you for your business ❤️",
};

export const deliveryUpsellStep = {
  minutes: 0,
  channel: "EMAIL",
  subject: "⛵ Last Chance to Add Corals Before We Pack Your Box! 🌎",
  content: deliveryUpsellContent,
};

export function validateDeliveryUpsell(value: unknown): DeliveryUpsellConfig {
  if (!value || typeof value !== "object")
    throw new Error("Delivery upsell settings are required.");
  const d = value as Partial<DeliveryUpsellConfig>;
  if (!Number.isInteger(d.daysBefore) || d.daysBefore! < 1 || d.daysBefore! > 30)
    throw new Error("Choose 1–30 calendar days before delivery.");
  if (!Number.isInteger(d.sendHour) || d.sendHour! < 0 || d.sendHour! > 23)
    throw new Error("Choose a send hour from 0–23.");
  const timezone = String(d.timezone || "");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new Error("Choose a valid scheduling timezone.");
  }
  const testEmail = d.testEmail === undefined ? undefined : email(d.testEmail);
  return {
    version: 1,
    daysBefore: d.daysBefore!,
    sendHour: d.sendHour!,
    timezone,
    ...(testEmail ? { testEmail } : {}),
    ...(testEmail && d.bypassRecentEmailSuppression === true
      ? { bypassRecentEmailSuppression: true }
      : {}),
  };
}

export function deliveryUpsellDraft(value: FlowConfig): FlowConfig {
  if (value.delivery) return value;
  const old = value.steps?.[0];
  return {
    ...value,
    reviewed: false,
    delivery: defaultDeliveryUpsell,
    description:
      "Send one add-on reminder two calendar days before the Shopify delivery-date tag. Triom handles order merging and refunds.",
    steps: [{
      ...deliveryUpsellStep,
      ...(old?.subject && old.subject !== "24 Hour Notice | Upsell" ? { subject: old.subject } : {}),
      content: {
        ...deliveryUpsellContent,
        ...(old?.content &&
        (old.content.heading !== "Discover your next reef favorite" ||
          old.content.body !== "Explore the latest arrivals at Corals Anonymous.")
          ? old.content
          : {}),
      },
    }],
  };
}

export type DeliveryCalendarDate = { year: number; month: number; day: number };

export function deliveryDateFromTags(
  tags: unknown,
  now = new Date(),
): DeliveryCalendarDate | null {
  const values = Array.isArray(tags) ? tags : String(tags || "").split(",");
  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  for (const value of values) {
    const raw = String(value).trim();
    const dateText = raw
      .replace(/^(shipping|shiping|ship)\b[\s:_-]*/i, "")
      .trim();
    const iso = dateText.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const named = dateText.match(
      /^([a-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?$/i,
    );
    let result: DeliveryCalendarDate | null = null;
    if (iso)
      result = {
        year: Number(iso[1]),
        month: Number(iso[2]),
        day: Number(iso[3]),
      };
    else if (named) {
      const month = months.indexOf(named[1].toLowerCase()) + 1;
      if (!month) continue;
      let year = named[3] ? Number(named[3]) : now.getFullYear();
      const day = Number(named[2]);
      if (!named[3]) {
        const candidate = Date.UTC(year, month - 1, day);
        if (candidate < Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - 86400000)
          year += 1;
      }
      result = { year, month, day };
    }
    if (!result || result.year < 2020 || result.year > 2100) continue;
    const checked = new Date(Date.UTC(result.year, result.month - 1, result.day));
    if (
      checked.getUTCFullYear() === result.year &&
      checked.getUTCMonth() + 1 === result.month &&
      checked.getUTCDate() === result.day
    )
      return result;
  }
  return null;
}

function localDateTime(date: DeliveryCalendarDate, hour: number, timezone: string) {
  const target = Date.UTC(date.year, date.month - 1, date.day, hour);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  for (let offset = -18 * 60; offset <= 18 * 60; offset++) {
    const candidate = new Date(target + offset * 60000);
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map((p) => [p.type, p.value]));
    if (Number(parts.year) === date.year && Number(parts.month) === date.month && Number(parts.day) === date.day && Number(parts.hour) === hour && Number(parts.minute) === 0)
      return candidate;
  }
  throw new Error("Could not resolve the delivery reminder time.");
}

export function deliveryUpsellDueAt(delivery: DeliveryCalendarDate, config: DeliveryUpsellConfig) {
  const day = new Date(Date.UTC(delivery.year, delivery.month - 1, delivery.day));
  day.setUTCDate(day.getUTCDate() - config.daysBefore);
  return localDateTime(
    { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() },
    config.sendHour,
    config.timezone,
  );
}
