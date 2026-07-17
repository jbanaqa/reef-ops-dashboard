const SHOPIFY_API_VERSION = "2026-07";

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

  const response = await fetch(
    `https://${shopDomain}/admin/oauth/access_token`,
    {
      method: "POST",
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

  const data = await response.json();

  if (!response.ok) {
    console.error("Shopify access token error:", data);
    throw new Error("Failed to get Shopify access token.");
  }

  if (!data.access_token) {
    console.error("Shopify access token response missing token:", data);
    throw new Error("Shopify access token response did not include access_token.");
  }

  return String(data.access_token);
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

  const data = await response.json();

  if (!response.ok) {
    console.error("Shopify GraphQL HTTP error:", data);
    throw new Error("Shopify GraphQL request failed.");
  }

  if (data.errors) {
    console.error("Shopify GraphQL errors:", data.errors);
    throw new Error("Shopify GraphQL returned errors.");
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
