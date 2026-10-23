import { shopifyGraphql as coralsGraphql } from "@/lib/shopify";
import { macroalgaeGraphql } from "@/lib/macroalgae-shopify";
import { currentMarketingBrand, marketingShop } from "./context";

export const getShopifyShopDomain = marketingShop;

/** Every marketing Shopify operation uses the same store as its scoped database rows. */
export async function shopifyGraphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  marketingShop(); // Reject a misconfigured store boundary before any network request.
  return currentMarketingBrand() === "macroalgae-farms"
    ? macroalgaeGraphql<T>(query, variables)
    : coralsGraphql<T>(query, variables);
}
