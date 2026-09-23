import { getShopifyShopDomain, shopifyGraphql } from "@/lib/shopify";
import {
  type CampaignEmailProduct,
  type CampaignProductFeed,
  type CampaignProductFeedOrder,
  type Content,
} from "./rules";
import { recommendationHistory } from "./cart-feed";

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
  query MarketingCampaignProducts($after: String, $query: String!, $sortKey: ProductSortKeys!, $reverse: Boolean!) {
    products(first: 50, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
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

function feedQuery(feed: CampaignProductFeed) {
  if (!feed.tags.length) return "status:active";
  const tags = feed.tags.map((tag) => `tag:${tag}`).join(" OR ");
  return `status:active AND (${tags})`;
}

async function feedCatalog(feed: CampaignProductFeed) {
  const products: ShopifyProduct[] = [];
  let after: string | null = null;
  let complete = false;
  // A bounded catalogue read prevents a malformed store response from holding
  // campaign preparation indefinitely. Refuse to send rather than truncate.
  for (let page = 0; page < 10; page++) {
    const response: ProductsResponse = await shopifyGraphql<ProductsResponse>(
      PRODUCTS,
      {
        after,
        query: feedQuery(feed),
        ...shopifySort(feed.order),
      },
    );
    const connection = response.data?.products;
    if (!connection) throw new Error("Shopify did not return the product catalogue.");
    products.push(...connection.nodes);
    const eligible = eligibleProducts(products, feed);
    if (isShopifyOrdered(feed.order) && eligible.length >= feed.limit) {
      complete = true;
      break;
    }
    if (!connection.pageInfo.hasNextPage) {
      complete = true;
      break;
    }
    after = connection.pageInfo.endCursor;
    if (!after) throw new Error("Shopify product pagination was incomplete.");
  }
  if (!complete)
    throw new Error(`The ${feed.name} feed is too large to prepare safely in one request.`);
  return products;
}

function eligibleProducts(products: ShopifyProduct[], feed: CampaignProductFeed) {
  const wanted = new Set(feed.tags.map((tag) => tag.toLocaleLowerCase()));
  const eligible = products.filter((product) => {
    if (!product.onlineStoreUrl) return false;
    if (!product.variants.nodes.some((variant) => variant.availableForSale)) return false;
    return (
      wanted.size === 0 ||
      product.tags.some((tag) => wanted.has(tag.toLocaleLowerCase()))
    );
  });
  return eligible;
}

function shopifySort(order: CampaignProductFeedOrder) {
  if (order === "oldest") return { sortKey: "CREATED_AT", reverse: false };
  if (order === "title-asc") return { sortKey: "TITLE", reverse: false };
  if (order === "title-desc") return { sortKey: "TITLE", reverse: true };
  return { sortKey: "CREATED_AT", reverse: true };
}

function isShopifyOrdered(order: CampaignProductFeedOrder) {
  return ["newest", "oldest", "title-asc", "title-desc"].includes(order);
}

type Popularity = { sales: Map<string, number>; views: Map<string, number> };

function numericProductId(product: ShopifyProduct) {
  return product.id.split("/").pop() || product.id;
}

function productPrice(product: ShopifyProduct) {
  const variant = product.variants.nodes.find((item) => item.availableForSale);
  const amount = Number(variant?.price);
  return Number.isFinite(amount) ? amount : Number.POSITIVE_INFINITY;
}

export function sortCampaignProducts(
  products: ShopifyProduct[],
  order: CampaignProductFeedOrder,
  popularity?: Popularity,
) {
  const result = [...products];
  const newest = (a: ShopifyProduct, b: ShopifyProduct) =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id);
  if (order === "random") return result;
  if (order === "newest") return result.sort(newest);
  if (order === "oldest") return result.sort((a, b) => -newest(a, b));
  if (order === "title-asc")
    return result.sort((a, b) => a.title.localeCompare(b.title) || newest(a, b));
  if (order === "title-desc")
    return result.sort((a, b) => b.title.localeCompare(a.title) || newest(a, b));
  if (order === "price-low")
    return result.sort((a, b) => productPrice(a) - productPrice(b) || newest(a, b));
  if (order === "price-high")
    return result.sort((a, b) => productPrice(b) - productPrice(a) || newest(a, b));
  const scores = order === "best-selling" ? popularity?.sales : popularity?.views;
  return result.sort(
    (a, b) =>
      (scores?.get(numericProductId(b)) || 0) -
        (scores?.get(numericProductId(a)) || 0) || newest(a, b),
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
  const feeds = layout.sections.flatMap((section) =>
    section.type === "products" && section.feed
      ? [{ sectionId: section.id, feed: section.feed }]
      : [],
  );
  const catalogs = new Map(
    await Promise.all(
      feeds.map(
        async ({ sectionId, feed }) =>
          [sectionId, await feedCatalog(feed)] as const,
      ),
    ),
  );
  const needsPopularity = feeds.some(({ feed }) =>
    ["best-selling", "most-viewed"].includes(feed.order),
  );
  const popularity = needsPopularity ? await recommendationHistory() : undefined;
  return {
    ...source,
    campaignLayout: {
      ...layout,
      sections: layout.sections.map((section) => {
        if (section.type !== "products" || !section.feed) return section;
        const matching = sortCampaignProducts(
          eligibleProducts(catalogs.get(section.id) || [], section.feed),
          section.feed.order,
          popularity,
        );
        const selected =
          section.feed.order === "random"
            ? seededShuffle(matching, `${seed}:${section.id}:${section.feed.key}`)
            : matching;
        return {
          ...section,
          products: selected.slice(0, section.feed.limit).map(emailProduct),
        };
      }),
    },
  } satisfies Content;
}

/** Resolve the Welcome social grid with the same Shopify selection as campaign feeds. */
export async function resolveWelcomeSocialProducts(source: Content, seed: string) {
  const feed = source.socialProductFeed;
  if (!feed) return source;
  const resolved = await resolveCampaignProductFeeds({
    ...source,
    campaignLayout: {
      navigation: [],
      sections: [{ id: "welcome-social-products", type: "products", feed, products: [] }],
      style: source.campaignLayout?.style || {
        fontFamily: "Arial", emailBackground: "#fff", contentBackground: "#fff",
        textColor: "#080808", salePriceColor: "#e84218", buttonBackground: "#e69a49",
        buttonTextColor: "#fff", productAlignment: "center", productGap: 12,
        sectionPadding: 12, productImageWidth: 168, buttonRadius: 4,
        titleSize: 15, priceSize: 15,
      },
    },
  }, seed);
  const section = resolved.campaignLayout?.sections[0];
  const products = section?.type === "products" ? section.products : [];
  if (!products.length) throw new Error("Welcome social product feed returned no eligible products.");
  return {
    ...source,
    products: products.map((product) => ({
      title: product.title,
      url: product.url,
      image: product.image,
      price: product.salePrice,
      compareAtPrice: product.compareAtPrice,
    })),
  } satisfies Content;
}
