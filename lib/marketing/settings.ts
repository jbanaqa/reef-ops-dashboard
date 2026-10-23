import { currentMarketingBrand, marketingEnv } from "./context";
import { email, marketingSettings, type MarketingSettings } from "./rules";

/** Server-only defaults: a new store must never inherit another store's identity or permissions. */
export function scopedMarketingSettings(value: unknown): MarketingSettings {
  const saved = (value || {}) as Partial<MarketingSettings>;
  if (currentMarketingBrand() === "corals-anonymous")
    return marketingSettings(saved, marketingEnv("MARKETING_POSTAL_ADDRESS") || "");
  return marketingSettings({
    ...saved,
    organizationName: saved.organizationName || "Macroalgae Farms",
    sender: { name: "Macroalgae Farms", email: "", replyTo: "", ...saved.sender },
    branding: {
      footerConfigured: true,
      footerBackgroundColor: "#174d3c",
      footerTextColor: "#ffffff",
      footerUnsubscribeText: "No longer want to receive these emails?",
      footerUnsubscribeLinkText: "Unsubscribe",
      showPostalAddress: true,
      showFooterSocial: false,
      showFooterCopyright: true,
      footerCopyrightText: "© {{ year }} {{ organization }}",
      ...saved.branding,
    },
    operations: {
      sendingEnabled: false, migrationConfirmed: false, ingestEnabled: false,
      ...saved.operations,
      formEnabled: false,
    },
  }, marketingEnv("MARKETING_POSTAL_ADDRESS") || "");
}

export function validateMarketingSender(settings: MarketingSettings) {
  const sender = settings.sender;
  if (!sender) return;
  if (sender.email) {
    const address = email(sender.email);
    if (currentMarketingBrand() === "macroalgae-farms") {
      const domain = address.split("@")[1];
      const configured = marketingEnv("RESEND_FROM_EMAIL")?.match(/<?([^<>\s]+@[^<>\s]+)>?$/)?.[1]?.split("@")[1]?.toLowerCase();
      if (domain !== "macroalgaefarms.com" && !domain.endsWith(".macroalgaefarms.com") && domain !== configured)
        throw Error("Use a Macroalgae Farms sending address. Corals Anonymous sender details are separate.");
    }
  }
  if (sender.replyTo) email(sender.replyTo);
}
