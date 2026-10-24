const SHOPIFY_API_VERSION = "2026-07";

type TokenEntry = { secret: string; token?: string; expiresAt?: number; request?: Promise<string> };
// Authentication belongs to the store and app credentials, never to a report request.
const tokenEntries = new Map<string, TokenEntry>();

async function responseJson(response: Response, operation: string): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Shopify ${operation} returned HTTP ${response.status} with a non-JSON response.`);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error(`Shopify ${operation} returned HTTP ${response.status} with an invalid response.`);
  if (!response.ok) throw new Error(`Shopify ${operation} request failed with HTTP ${response.status}.`);
  return body as Record<string, unknown>;
}

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function normalizeShopDomain(shopDomain: string) {
  return shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function getShopifyShopDomain() {
  return normalizeShopDomain(getRequiredEnv("SHOPIFY_SHOP_DOMAIN"));
}

export async function getShopifyAccessToken() {
  const shopDomain = getShopifyShopDomain();
  const clientId = getRequiredEnv("SHOPIFY_CLIENT_ID");
  const clientSecret = getRequiredEnv("SHOPIFY_CLIENT_SECRET");
  const key = JSON.stringify([shopDomain, clientId]);
  let entry = tokenEntries.get(key);
  if (!entry || entry.secret !== clientSecret) {
    entry = { secret: clientSecret };
    tokenEntries.set(key, entry);
  }
  if (entry.token && (entry.expiresAt || 0) > Date.now()) return entry.token;
  if (entry.request) return entry.request;
  const current = entry;
  current.request = (async () => {
    const response = await fetch(
      `https://${shopDomain}/admin/oauth/access_token`,
      {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }),
      }
    );

    const data = await responseJson(response, "authentication");
    if (typeof data.access_token !== "string" || !data.access_token)
      throw new Error("Shopify authentication response did not include an access token.");
    const lifetime = Number(data.expires_in) * 1000;
    // Shopify returns expires_in. An unknown lifetime is never cached past this request.
    current.expiresAt = Date.now() + (Number.isFinite(lifetime) && lifetime > 0
      ? Math.max(0, lifetime - Math.min(300000, lifetime / 10)) : 0);
    current.token = data.access_token;
    return data.access_token;
  })().finally(() => { current.request = undefined; });
  return current.request;
}

export async function shopifyGraphql<TData = unknown>(
  query: string,
  variables?: Record<string, unknown>
) {
  const shopDomain = getShopifyShopDomain();
  const accessToken = await getShopifyAccessToken();

  const response = await fetch(
    `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    }
  );

  if (response.status === 401) {
    const entry = tokenEntries.get(JSON.stringify([shopDomain, getRequiredEnv("SHOPIFY_CLIENT_ID")]));
    if (entry?.token === accessToken) { entry.token = undefined; entry.expiresAt = 0; }
  }
  const data = await responseJson(response, "GraphQL");

  if (Array.isArray(data.errors) && data.errors.length) {
    const codes = [...new Set(data.errors.flatMap((error: { extensions?: { code?: unknown } }) =>
      typeof error?.extensions?.code === "string" ? [error.extensions.code] : []))];
    throw new Error("Shopify GraphQL returned errors" + (codes.length ? ` (${codes.join(", ")})` : "") + ".");
  }

  return data as TData;
}

type InventoryItemDetailsResponse = {
  data?: {
    inventoryItem?: {
      id: string;
      legacyResourceId: string;
      sku: string | null;
      variant: {
        id: string;
        legacyResourceId: string;
        title: string;
        product: {
          id: string;
          legacyResourceId: string;
          title: string;
          handle: string;
        };
      } | null;
    } | null;
  };
};

const INVENTORY_ITEM_DETAILS_QUERY = `
  query InventoryItemDetails($id: ID!) {
    inventoryItem(id: $id) {
      id
      legacyResourceId
      sku
      variant {
        id
        legacyResourceId
        title
        product {
          id
          legacyResourceId
          title
          handle
        }
      }
    }
  }
`;

function toInventoryItemGid(inventoryItemId: string) {
  if (inventoryItemId.startsWith("gid://shopify/InventoryItem/")) {
    return inventoryItemId;
  }

  return `gid://shopify/InventoryItem/${inventoryItemId}`;
}

export async function getInventoryItemDetails(inventoryItemId: string) {
  const response = await shopifyGraphql<InventoryItemDetailsResponse>(
    INVENTORY_ITEM_DETAILS_QUERY,
    {
      id: toInventoryItemGid(inventoryItemId),
    }
  );

  const inventoryItem = response.data?.inventoryItem;

  if (!inventoryItem) {
    return null;
  }

  const variant = inventoryItem.variant;

  return {
    inventoryItemId: inventoryItem.legacyResourceId || inventoryItemId,
    sku: inventoryItem.sku || null,

    variantId: variant?.legacyResourceId
      ? String(variant.legacyResourceId)
      : null,
    variantTitle: variant?.title || null,

    productId: variant?.product?.legacyResourceId
      ? String(variant.product.legacyResourceId)
      : null,
    productTitle: variant?.product?.title || null,
    productHandle: variant?.product?.handle || null,
  };
}

type ProductInventoryDetailsResponse = {
  data?: {
    product?: {
      id: string;
      legacyResourceId: string;
      title: string;
      handle: string;
      totalInventory: number;
      status: string;
      tracksInventory: boolean;
    } | null;
  };
};

const PRODUCT_INVENTORY_DETAILS_QUERY = `
  query ProductInventoryDetails($id: ID!) {
    product(id: $id) {
      id
      legacyResourceId
      title
      handle
      totalInventory
      status
      tracksInventory
    }
  }
`;

function toProductGid(productId: string) {
  if (productId.startsWith("gid://shopify/Product/")) {
    return productId;
  }

  return `gid://shopify/Product/${productId}`;
}

export async function getProductInventoryDetails(
  productId: string
) {
  const response =
    await shopifyGraphql<ProductInventoryDetailsResponse>(
      PRODUCT_INVENTORY_DETAILS_QUERY,
      {
        id: toProductGid(productId),
      }
    );

  const product = response.data?.product;

  if (!product) {
    return null;
  }

  return {
    productId: String(product.legacyResourceId),
    productTitle: product.title,
    productHandle: product.handle,
    totalAvailable: product.totalInventory,
    status: product.status,
    tracksInventory: product.tracksInventory,
  };
}
