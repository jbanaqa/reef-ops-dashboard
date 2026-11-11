import { shopifyGraphql as coralsGraphql } from "@/lib/shopify";
import { macroalgaeGraphql } from "@/lib/macroalgae-shopify";
import { currentMarketingBrand, marketingShop } from "./context";
import { ShopifyRequestNotExecutedError } from "@/lib/shopify-request-error";

export const getShopifyShopDomain = marketingShop;

/** Every marketing Shopify operation uses the same store as its scoped database rows. */
export async function shopifyGraphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  try { marketingShop(); } // Reject a misconfigured store boundary before any network request.
  catch (error) { throw new ShopifyRequestNotExecutedError(error); }
  return currentMarketingBrand() === "macroalgae-farms"
    ? macroalgaeGraphql<T>(query, variables)
    : coralsGraphql<T>(query, variables);
}
