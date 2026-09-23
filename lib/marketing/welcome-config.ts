import { campaignProductFeed, defaultContent, type Content, email } from "./rules";
import { firstWelcomeBody, firstWelcomeBodyHtml, originalWelcomeReminderBody, originalWelcomeFinalBody, finalWelcomeBody } from "./welcome-copy";
import type { FlowConfig } from "./flow-config";

export type WelcomeConfig = {
  version: 1;
  couponDays: number;
  socialHour: number;
  fallbackTimezone: string;
  testEmail?: string;
  bypassRecentEmailSuppression?: boolean;
};
export const welcomeLabels = [
  "Welcome · 10% off",
  "First reminder",
  "Final reminder",
  "Follow us on social media",
];
export const welcomeSocialNavigation = [
  { label: "🔥 New Corals", url: "https://coralsanonymous.com/collections/new-arrivals" },
  { label: "🏷️ Deal Busters", url: "https://coralsanonymous.com/collections/deal-busters" },
  { label: "✚ Earn Points & Save!", url: "https://coralsanonymous.com/pages/rewards" },
];
export const defaultWelcome: WelcomeConfig = {
  version: 1,
  couponDays: 14,
  socialHour: 17,
  fallbackTimezone: "America/Los_Angeles",
};
const base: Content = {
  ...defaultContent,
  template: "welcome",
  footerTitle: "",
  preview: "",
  footerUnsubscribeText: "No longer want to receive these emails?",
};
export const welcomeSteps = [
  {
    minutes: 0,
    channel: "EMAIL",
    subject: "😁 👍 Thank you for signing up! 😁 👍",
    content: {
      ...base,
      offerAboveBody: true,
      heading: "Thanks for signing up!",
      preview: "Exclusive Offer: Enjoy 10% OFF your first order today!",
      body: firstWelcomeBody,
      bodyHtml: firstWelcomeBodyHtml,
      button: "Shop Now!",
    },
  },
  {
    minutes: 3 * 1440,
    channel: "EMAIL",
    subject: "⏳ Shop Now & Save 10% OFF Your First Order! ⏳",
    content: {
      ...base,
      welcomeVariant: "reminder" as const,
      heading: "Claim Your 10% OFF Discount Now!",
      body: "",
      button: "Use my 10% OFF code now!",
    },
  },
  {
    minutes: 10 * 1440,
    channel: "EMAIL",
    subject: "⏳ Final Reminder: 10% Off Discount Code Ending! ⏳",
    content: {
      ...base,
      welcomeVariant: "final-reminder" as const,
      heading: "Time is Running Out!",
      preview: "Your personal 10% discount is expiring soon.",
      body: finalWelcomeBody,
      button: "Use my 10% OFF code now!",
    },
  },
  {
    minutes: 15 * 1440,
    channel: "EMAIL",
    subject: "Follow us on Social Media!",
    content: {
      ...base,
      template: "welcome-social" as const,
      heading: "Follow us on Social Media!",
      body: "Join our reefing community for daily coral posts, sales, promo codes, and more!",
      button: "Discover new corals",
      socialNavigation: welcomeSocialNavigation,
      socialProductFeed: campaignProductFeed({ key: "newnew1", limit: 6 }),
    },
  },
];
export function validateWelcome(value: unknown): WelcomeConfig {
  const w = value as WelcomeConfig;
  if (
    !w ||
    w.version !== 1 ||
    !Number.isInteger(w.couponDays) ||
    w.couponDays < 2 ||
    w.couponDays > 90
  )
    throw new Error("Welcome discounts must last 2–90 days.");
  if (!Number.isInteger(w.socialHour) || w.socialHour < 0 || w.socialHour > 23)
    throw new Error("Choose a valid hour for the social email.");
  if (typeof w.fallbackTimezone !== "string" || !w.fallbackTimezone.trim())
    throw new Error("Choose a fallback timezone.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: w.fallbackTimezone }).format();
  } catch {
    throw new Error("Choose a valid fallback timezone.");
  }
  const testEmail = w.testEmail !== undefined ? email(w.testEmail) : undefined;
  if (w.bypassRecentEmailSuppression === true && !testEmail)
    throw new Error(
      "Recent-email bypass requires a specific Welcome test email.",
    );
  return {
    version: 1,
    couponDays: w.couponDays,
    socialHour: w.socialHour,
    fallbackTimezone: w.fallbackTimezone,
    ...(testEmail !== undefined ? { testEmail } : {}),
    ...(w.bypassRecentEmailSuppression === true
      ? { bypassRecentEmailSuppression: true }
      : {}),
  };
}
/** Only replace untouched scaffold copy; saved copy and artwork survive an upgrade. */
export function welcomeDraft(f: FlowConfig): FlowConfig {
  if (f.welcome) {
    const steps = f.steps.map((step, index) => {
      const upgraded = upgradeWelcomeStep(step.content, index);
      return upgraded === step.content ? step : { ...step, content: upgraded };
    });
    return steps.every((step, index) => step === f.steps[index])
      ? f
      : { ...f, steps };
  }
  return {
    ...f,
    reviewed: false,
    smsContent: undefined,
    orderBranch: undefined,
    welcome: { ...defaultWelcome },
    description:
      "Single opt-in · one entry per subscriber · one personal 10% code · automatic purchase checks",
    steps: welcomeSteps.map((preset, i) => {
      const old = f.steps[i];
      const custom = old ? Object.fromEntries(Object.entries(old.content).filter(([key, value]) =>
        value !== undefined && !["template", "couponCode", "couponExpiresAt"].includes(key) &&
        JSON.stringify(value) !== JSON.stringify(defaultContent[key as keyof Content]))) : {};
      return {
        ...preset,
        ...(old?.subject && old.subject !== "Welcome Series 08.2025" ? { subject: old.subject } : {}),
        content: { ...preset.content, ...custom },
      };
    }),
  };
}

/** Apply presentation updates to saved Welcome steps without overwriting staff copy. */
export function upgradeWelcomeStep(c: Content, index: number): Content {
  let next = c;
  if (index === 0 && c.body === firstWelcomeBody && c.bodyHtml === undefined)
    next = { ...next, bodyHtml: firstWelcomeBodyHtml };
  if (index === 1) {
    if (next.welcomeVariant === undefined) next = { ...next, welcomeVariant: "reminder" };
    if (next.body === originalWelcomeReminderBody && next.bodyHtml === undefined)
      next = { ...next, body: "" };
  }
  if (index === 2) {
    if (next.welcomeVariant === undefined) next = { ...next, welcomeVariant: "final-reminder" };
    if (next.body === originalWelcomeFinalBody && next.bodyHtml === undefined)
      next = { ...next, body: finalWelcomeBody };
  }
  if (index === 3 && next.template === "welcome-social") {
    if (!next.socialNavigation) next = { ...next, socialNavigation: welcomeSocialNavigation };
    if (!next.socialProductFeed) next = { ...next, socialProductFeed: campaignProductFeed({ key: "newnew1", limit: 6 }) };
  }
  return next;
}
