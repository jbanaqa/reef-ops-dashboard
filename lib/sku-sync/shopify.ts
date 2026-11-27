import { shopifyGraphql, getShopifyShopDomain } from "../shopify";
import { macroalgaeGraphql } from "../macroalgae-shopify";
import { assertSpeciesLibraryShop, normalizeShopDomain } from "../species-library";
import { ShopifyRequestNotExecutedError } from "../shopify-request-error";
import { normalizeProductVariantId } from "./mapping-source";

export type StoreSide = "A" | "B";
export type VariantSnapshot = {
  variantId: string;
  inventoryItemId?: string;
  productId: string;
  title: string;
  variantTitle: string;
  sku: string;
  url: string | null;
};
export type SkuSyncRequestOptions = { signal?: AbortSignal; deadline?: number; timeoutMs?: number };
export type SkuSyncGraphqlTransport = (
  side: StoreSide,
  query: string,
  variables: Record<string, unknown>,
) => Promise<unknown>;

/** allowPartialUpdates:false means Shopify persisted none of this one-variant mutation. */
export class SkuSyncMutationRejectedError extends ShopifyRequestNotExecutedError {
  constructor(message: string) {
    super(new Error(message));
    this.name = "SkuSyncMutationRejectedError";
  }
}

/** In-flight timeouts/invalid mutation acknowledgements require a fresh read before retry. */
export class SkuSyncRequestUncertainError extends Error {
  constructor(message: string) { super(message); this.name = "SkuSyncRequestUncertainError"; }
}

export const SKU_SYNC_VARIANTS_QUERY = `
  query SkuSyncVariantSnapshots($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on ProductVariant {
        id title sku
        inventoryItem { id }
        product { id title onlineStoreUrl }
      }
    }
  }
`;

// https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/productVariantsBulkUpdate
// Only SKU is supplied. In particular, never supply quantities, prices or inventory tracking.
export const SKU_SYNC_UPDATE_MUTATION = `
  mutation SkuSyncUpdateVariantSku($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) {
      productVariants { id sku }
      userErrors { field message code }
    }
  }
`;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function productId(value: unknown): string {
  if (typeof value !== "string" || !/^gid:\/\/shopify\/Product\/[1-9]\d*$/.test(value))
    throw new Error("Invalid Shopify product ID in variant snapshot.");
  return value;
}

export function parseInventoryItemId(value: unknown): string | undefined {
  return typeof value === "string" && /^gid:\/\/shopify\/InventoryItem\/[1-9]\d{0,19}$/.test(value)
    ? value : undefined;
}

function variantUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Invalid product URL in Shopify variant snapshot.");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid URL.");
    return url.toString();
  } catch { throw new Error("Invalid product URL in Shopify variant snapshot."); }
}

/** No URL or secret values are returned in configuration errors. */
export function getSkuSyncConfigurationError(): string | null {
  const names = ["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET",
    "SPECIES_LIBRARY_SHOP_DOMAIN", "MACROALGAE_SHOPIFY_CLIENT_ID", "MACROALGAE_SHOPIFY_CLIENT_SECRET"];
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length) return `SKU Sync is not configured: missing ${missing.join(", ")}.`;
  try {
    const a = normalizeShopDomain(getShopifyShopDomain());
    const b = normalizeShopDomain(assertSpeciesLibraryShop());
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(a) || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(b))
      return "SKU Sync requires valid Shopify store domains.";
    if (a === b) return "SKU Sync requires two different Shopify stores.";
  } catch { return "SKU Sync store configuration is invalid."; }
  return null;
}

async function defaultTransport(side: StoreSide, query: string, variables: Record<string, unknown>) {
  return side === "A" ? shopifyGraphql(query, variables) : macroalgaeGraphql(query, variables);
}

/** The shared clients cannot cancel in-flight I/O; a timed-out mutation stays uncertain. */
async function boundedRequest(
  operation: () => Promise<unknown>, options: SkuSyncRequestOptions, mutation: boolean,
): Promise<unknown> {
  const timeoutMs = Math.min(options.timeoutMs ?? 20_000, 20_000);
  const remaining = Math.min(timeoutMs, (options.deadline ?? Infinity) - Date.now());
  if (options.signal?.aborted || !Number.isFinite(remaining) || remaining <= 0)
    throw new ShopifyRequestNotExecutedError(new Error("SKU Sync request was cancelled or expired before it started."));
  return new Promise((resolve, reject) => {
    let settled = false;
    let started = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancelled);
      callback();
    };
    const interrupted = () => mutation && started
      ? new SkuSyncRequestUncertainError("SKU update did not finish within its deadline; read Shopify again before retrying.")
      : !started
        ? new ShopifyRequestNotExecutedError(new Error("SKU Sync request expired before it started."))
        : new Error("Shopify SKU snapshot request was cancelled or timed out.");
    const cancelled = () => finish(() => reject(interrupted()));
    const timer = setTimeout(cancelled, remaining);
    options.signal?.addEventListener("abort", cancelled, { once: true });
    // Attaching both handlers also observes a response that arrives after our deadline.
    Promise.resolve().then(() => {
      if (settled) return;
      started = true;
      return operation();
    }).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export function createSkuSyncShopifyAdapter(transport: SkuSyncGraphqlTransport = defaultTransport) {
  return {
    async fetchVariantSnapshots(side: StoreSide, ids: string[], options: SkuSyncRequestOptions = {}) {
      if (side !== "A" && side !== "B") throw new Error("Invalid SKU Sync store.");
      const unique = [...new Set(ids.map(normalizeProductVariantId))];
      const snapshots = new Map<string, VariantSnapshot>();
      for (let offset = 0; offset < unique.length; offset += 100) {
        const chunk = unique.slice(offset, offset + 100);
        const response = await boundedRequest(() => transport(side, SKU_SYNC_VARIANTS_QUERY, { ids: chunk }), options, false);
        if (!record(response) || (Array.isArray(response.errors) && response.errors.length) ||
          !record(response.data) || !Array.isArray(response.data.nodes) || response.data.nodes.length !== chunk.length)
          throw new Error("Shopify returned an incomplete SKU snapshot response.");
        const expected = new Set(chunk);
        for (const node of response.data.nodes as unknown[]) {
          if (node === null) continue; // Deleted/unavailable variants remain absent, not blank-SKU products.
          if (!record(node) || node.__typename !== "ProductVariant" || !record(node.product) ||
            typeof node.title !== "string" || typeof node.product.title !== "string" ||
            (node.sku !== null && typeof node.sku !== "string"))
            throw new Error("Shopify returned an invalid SKU snapshot.");
          const id = normalizeProductVariantId(node.id);
          if (!expected.has(id) || snapshots.has(id)) throw new Error("Shopify returned an unexpected or duplicate variant.");
          const inventoryItemId = record(node.inventoryItem) ? parseInventoryItemId(node.inventoryItem.id) : undefined;
          if (node.inventoryItem !== undefined && !inventoryItemId)
            throw new Error("Shopify returned an invalid inventory item in the SKU snapshot.");
          snapshots.set(id, {
            variantId: id, ...(inventoryItemId ? { inventoryItemId } : {}),
            productId: productId(node.product.id), title: node.product.title,
            variantTitle: node.title, sku: node.sku ?? "", url: variantUrl(node.product.onlineStoreUrl),
          });
        }
      }
      return snapshots;
    },

    async updateVariantSku(side: StoreSide, snapshot: VariantSnapshot, newSku: string, options: SkuSyncRequestOptions = {}): Promise<void> {
      if (side !== "A" && side !== "B") throw new ShopifyRequestNotExecutedError(new Error("Invalid SKU Sync store."));
      // An explicitly confirmed clear is a legitimate edit; do not trim or invent a SKU.
      if (typeof newSku !== "string")
        throw new ShopifyRequestNotExecutedError(new Error("The new SKU must be text."));
      let id: string, parentId: string;
      try {
        id = normalizeProductVariantId(snapshot.variantId);
        parentId = productId(snapshot.productId);
      } catch (error) { throw new ShopifyRequestNotExecutedError(error); }
      const response = await boundedRequest(() => transport(side, SKU_SYNC_UPDATE_MUTATION, {
        productId: parentId, variants: [{ id, inventoryItem: { sku: newSku } }],
      }), options, true);
      const payload = record(response) && !(Array.isArray(response.errors) && response.errors.length) && record(response.data)
        ? response.data.productVariantsBulkUpdate : null;
      if (!record(payload) || !Array.isArray(payload.userErrors))
        throw new SkuSyncRequestUncertainError("Shopify did not acknowledge the SKU update; read it again before retrying.");
      if (payload.userErrors.length) {
        const messages = payload.userErrors.map((error: unknown) => record(error) && typeof error.message === "string" ? error.message : "Variant update rejected.");
        throw new SkuSyncMutationRejectedError(`Shopify rejected the SKU update: ${messages.join("; ")}`);
      }
      if (!Array.isArray(payload.productVariants) || payload.productVariants.length !== 1 ||
        !record(payload.productVariants[0]) || payload.productVariants[0].id !== id ||
        (payload.productVariants[0].sku !== null && typeof payload.productVariants[0].sku !== "string") ||
        (payload.productVariants[0].sku ?? "") !== newSku)
        throw new SkuSyncRequestUncertainError("Shopify returned an unconfirmed SKU update; read it again before retrying.");
    },
  };
}

const adapter = createSkuSyncShopifyAdapter();
export const fetchVariantSnapshots = adapter.fetchVariantSnapshots;
export const updateVariantSku = adapter.updateVariantSku;
