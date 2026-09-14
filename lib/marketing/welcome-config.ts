import { defaultContent, type Content, email } from "./rules";
import type { FlowConfig } from "./flow-config";

export type WelcomeConfig = {
  version: 1;
  couponDays: number;
  socialHour: number;
  fallbackTimezone: string;
  testEmail?: string;
};
export const welcomeLabels = [
  "Welcome · 10% off",
  "First reminder",
  "Final reminder",
  "Follow us on social media",
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
      body: 'Aloha {{ first_name|default:"Friend" }},\n\nWelcome to Corals Anonymous! We’re thrilled to have you join our reefing family. 🐠 💙\n\nOur story started at the peak of COVID. With nowhere to go and too much free time, we turned to the one thing that always made us happy—reefing. Out of that passion (and a little boredom), Corals Anonymous was born.\n\nToday, we’re proud to be a treasure cove for saltwater hobbyists, dealing the most addictive stuff—corals and anemones! We dedicate ourselves to providing:\n\n✨ High-quality, healthy corals and anemones\n✨ Rare and unique selections from around the world\n✨ The best deals for our fellow reefers who can’t get enough of that “reefer-high”\n\nGot questions or just want to talk reefing? Reach us anytime at happyreefing@coralsanonymous.com — we love hearing from our fellow reefers.',
      button: "Shop Now!",
    },
  },
  {
    minutes: 3 * 1440,
    channel: "EMAIL",
    subject: "⏳ Shop Now & Save 10% OFF Your First Order! ⏳",
    content: {
      ...base,
      heading: "Claim Your 10% OFF Discount Now!",
      body: "Your first order is waiting. Explore our corals and anemones and use your personal code to save 10% on your order.",
      button: "Use my 10% OFF code now!",
    },
  },
  {
    minutes: 10 * 1440,
    channel: "EMAIL",
    subject: "⏳ Final Reminder: 10% Off Discount Code Ending! ⏳",
    content: {
      ...base,
      heading: "Time is Running Out!",
      preview: "Your personal 10% discount is expiring soon.",
      body: "Your discount code is going to expire on {{ coupon_expires }}. Treat your reef before your offer ends!",
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
  return {
    version: 1,
    couponDays: w.couponDays,
    socialHour: w.socialHour,
    fallbackTimezone: w.fallbackTimezone,
    ...(w.testEmail !== undefined ? { testEmail: email(w.testEmail) } : {}),
  };
}
/** Only replace untouched scaffold copy; saved copy and artwork survive an upgrade. */
export function welcomeDraft(f: FlowConfig): FlowConfig {
  if (f.welcome) return f;
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
