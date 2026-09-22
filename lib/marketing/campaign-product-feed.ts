import { getShopifyShopDomain, shopifyGraphql } from "@/lib/shopify";
import {
  type CampaignEmailProduct,
  type CampaignProductFeed,
  type Content,
} from "./rules";

type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  tags: string[];
  createdAt: string;
  onlineStoreUrl: string | null;
  featuredImage: { url: string } | null;
  variants: {
    nodes: Array<{
      id: string;
      availableForSale: boolean;
      price: string;
      compareAtPrice: string | null;
      image: { url: string } | null;
    }>;
  };
};

type ProductsResponse = {
  data?: {
    products?: {
      nodes: ShopifyProduct[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
};

const PRODUCTS = `
  query MarketingCampaignProducts($after: String) {
    products(first: 50, after: $after, query: "status:active", sortKey: CREATED_AT, reverse: true) {
      nodes {
        id title handle tags createdAt onlineStoreUrl
        featuredImage { url }
        variants(first: 10) {
          nodes { id availableForSale price compareAtPrice image { url } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function money(value: string | null) {
  if (!value) return undefined;
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      })
    : undefined;
}

function numberHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededShuffle<T>(items: T[], seed: string) {
  const result = [...items];
  let state = numberHash(seed) || 1;
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

async function campaignCatalog() {
  const products: ShopifyProduct[] = [];
  let after: string | null = null;
  let complete = false;
  // A bounded catalogue read prevents a malformed store response from holding
  // campaign preparation indefinitely. Refuse to send rather than truncate.
  for (let page = 0; page < 40; page++) {
    const response: ProductsResponse = await shopifyGraphql<ProductsResponse>(
      PRODUCTS,
      { after },
    );
    const connection = response.data?.products;
    if (!connection) throw new Error("Shopify did not return the product catalogue.");
    products.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) {
      complete = true;
      break;
    }
    after = connection.pageInfo.endCursor;
    if (!after) throw new Error("Shopify product pagination was incomplete.");
  }
  if (!complete)
    throw new Error("The Shopify catalogue is too large to prepare safely in one campaign run.");
  return products;
}

function candidates(products: ShopifyProduct[], feed: CampaignProductFeed) {
  const wanted = new Set(feed.tags.map((tag) => tag.toLocaleLowerCase()));
  const eligible = products.filter((product) => {
    if (!product.onlineStoreUrl) return false;
    if (!product.variants.nodes.some((variant) => variant.availableForSale)) return false;
    return (
      wanted.size === 0 ||
      product.tags.some((tag) => wanted.has(tag.toLocaleLowerCase()))
    );
  });
  return feed.order === "random" ? eligible : eligible.sort((a, b) =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

function emailProduct(product: ShopifyProduct): CampaignEmailProduct {
  const variant = product.variants.nodes.find((item) => item.availableForSale)!;
  return {
    id: product.id,
    title: product.title,
    url:
      product.onlineStoreUrl ||
      `https://${getShopifyShopDomain()}/products/${product.handle}`,
    image: variant.image?.url || product.featuredImage?.url,
    salePrice: money(variant.price),
    compareAtPrice: money(variant.compareAtPrice),
    button: "Shop now",
    showSalePrice: true,
    showCompareAtPrice: true,
    showButton: true,
  };
}

export async function resolveCampaignProductFeeds(
  source: Content,
  seed = "campaign-preview",
) {
  const layout = source.campaignLayout;
  if (!layout?.sections.some((section) => section.type === "products" && section.feed))
    return source;
  const catalog = await campaignCatalog();
  return {
    ...source,
    campaignLayout: {
      ...layout,
      sections: layout.sections.map((section) => {
        if (section.type !== "products" || !section.feed) return section;
        const matching = candidates(catalog, section.feed);
        const selected =
          section.feed.order === "random"
            ? seededShuffle(matching, `${seed}:${section.feed.key}`)
            : matching;
        return {
          ...section,
          products: selected.slice(0, section.feed.limit).map(emailProduct),
        };
      }),
    },
  } satisfies Content;
}
