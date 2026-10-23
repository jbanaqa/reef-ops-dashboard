import { AsyncLocalStorage } from "node:async_hooks";
import { getShopifyShopDomain } from "@/lib/shopify";
import { getSpeciesLibraryShop } from "@/lib/species-library";
import { marketingBrand, type MarketingBrand } from "./brands";

const context = new AsyncLocalStorage<MarketingBrand>();

/** Legacy callers remain scoped to Corals Anonymous. Never mutate process.env per request. */
export function currentMarketingBrand(): MarketingBrand {
  return context.getStore() || "corals-anonymous";
}

export function runWithMarketingBrand<T>(brand: MarketingBrand, fn: () => T): T {
  return context.run(marketingBrand(brand).id, fn);
}

export function marketingShop(): string {
  if (currentMarketingBrand() === "corals-anonymous") return getShopifyShopDomain();
  const configured = getSpeciesLibraryShop();
  const coralsShop = (process.env.SHOPIFY_SHOP_DOMAIN || "")
    .trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (configured === coralsShop) throw new Error("Marketing stores must use different Shopify shops.");
  return configured;
}

export function marketingBrandForShop(domain: string): MarketingBrand | null {
  const requested = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const matches: MarketingBrand[] = [];
  try { if (getShopifyShopDomain().toLowerCase() === requested) matches.push("corals-anonymous"); } catch { /* Store is not configured. */ }
  try { if (getSpeciesLibraryShop() === requested) matches.push("macroalgae-farms"); } catch { /* Store is not configured. */ }
  return matches.length === 1 ? matches[0] : null;
}

/** Provider account, dashboard and deployment capability gates may be shared; sender/store identity may not. */
export function marketingEnv(name: string): string | undefined {
  if (currentMarketingBrand() === "corals-anonymous") return process.env[name];
  const scoped = process.env[`MACROALGAE_${name}`];
  if (scoped !== undefined) return scoped;
  if (["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "APP_BASE_URL"].includes(name))
    return process.env[name];
  if (name === "SHOPIFY_SHOP_DOMAIN") return process.env.SPECIES_LIBRARY_SHOP_DOMAIN;
  if (name === "MARKETING_STOREFRONT_ORIGIN") return marketingBrand("macroalgae-farms").storefrontOrigin;
  if (["MARKETING_SEND_ENABLED", "MARKETING_MIGRATION_CONFIRMED", "MARKETING_INGEST_ENABLED", "MARKETING_FORM_ENABLED"].includes(name))
    return process.env[name] || "false";
  return undefined;
}
