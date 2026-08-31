import { assertSpeciesLibraryShop, normalizeShopDomain } from "./species-library";

const API_VERSION = "2026-07";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function getAccessToken() {
  const shop = assertSpeciesLibraryShop();
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: required("MACROALGAE_SHOPIFY_CLIENT_ID"),
      client_secret: required("MACROALGAE_SHOPIFY_CLIENT_SECRET"),
    }),
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error("Macroalgae Shopify access token request failed.");
  return String(body.access_token);
}

export async function macroalgaeGraphql<T>(query: string, variables?: Record<string, unknown>) {
  const shop = assertSpeciesLibraryShop();
  if (normalizeShopDomain(shop) !== normalizeShopDomain(required("SPECIES_LIBRARY_SHOP_DOMAIN"))) {
    throw new Error("Macroalgae Shopify boundary mismatch.");
  }
  const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await getAccessToken() },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok || body.errors) throw new Error("Macroalgae Shopify GraphQL request failed.");
  return body as T;
}

export type SpeciesProductSnapshot = {
  id: string;
  title: string;
  handle: string;
  status: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  tags: string[];
  updatedAt: string;
  imageUrls: string[];
};

type ProductsResponse = {
  data?: { products: {
    nodes: Array<{
      id: string; title: string; handle: string; status: string;
      descriptionHtml: string; productType: string; vendor: string;
      tags: string[]; updatedAt: string;
      images: { nodes: Array<{ url: string }> };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  } };
};

const PRODUCTS_QUERY = `
  query SpeciesProducts($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      nodes {
        id title handle status descriptionHtml productType vendor tags updatedAt
        images(first: 10) { nodes { url } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function fetchSpeciesProducts(updatedAfter?: Date | null) {
  const products: SpeciesProductSnapshot[] = [];
  let cursor: string | null = null;
  const updatedFilter = updatedAfter ? ` updated_at:>'${updatedAfter.toISOString()}'` : "";
  const search = `status:active,draft${updatedFilter}`;

  do {
    const response: ProductsResponse = await macroalgaeGraphql<ProductsResponse>(PRODUCTS_QUERY, {
      first: 100, after: cursor, query: search,
    });
    const connection = response.data?.products;
    if (!connection) throw new Error("Macroalgae product query returned no product connection.");
    products.push(...connection.nodes.map((product) => ({
      id: product.id, title: product.title, handle: product.handle,
      status: product.status, descriptionHtml: product.descriptionHtml || "",
      productType: product.productType || "", vendor: product.vendor || "",
      tags: product.tags || [], updatedAt: product.updatedAt,
      imageUrls: product.images.nodes.map((image) => image.url),
    })));
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);

  return products;
}
