import products from "./macro-black-friday-products.json";
import type { CampaignEmailProduct, Content } from "./rules";

export const MACROALGAE_STOREFRONT = "https://www.macroalgaefarms.com";
export const MACRO_BLACK_FRIDAY_URL = MACROALGAE_STOREFRONT + "/#black-friday-sale";
export const MACRO_BLACK_FRIDAY_FEATURED_LIMIT = 2;
export const MACRO_BLACK_FRIDAY_GRID_LIMIT = 8;

export type MacroBlackFridayDesign = {
  featuredProducts: CampaignEmailProduct[];
  gridProducts: CampaignEmailProduct[];
};

const defaultSubtext = "Up to 50% OFF on qualifying $1,000+ orders. Pick out a coral for that open spot in your reef or add red and blue macroalgae.";

export const macroBlackFridayCampaignTemplate = {
  key: "macro-black-friday",
  name: "Black Friday Sale",
  subject: "Black Friday Sale at Macroalgae Farms",
  content: {
    layout: "macro-black-friday",
    template: "campaign-sale",
    heading: "Black Friday Sale",
    body: defaultSubtext,
    preview: "Up to 50% OFF on qualifying $1,000+ orders.",
    button: "Shop Black Friday",
    url: MACRO_BLACK_FRIDAY_URL,
    macroBlackFriday: products,
  } satisfies Content,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function shortText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function httpsUrl(value: unknown, message: string) {
  const raw = shortText(value, 501);
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error(message); }
  if (url.protocol !== "https:" || url.username || url.password || url.href.length > 500)
    throw new Error(message);
  return url;
}

function productCards(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  if (value.length > limit) throw new Error(`Choose up to ${limit} products for this section.`);
  const seen = new Set<string>();
  const cards: CampaignEmailProduct[] = [];
  for (const input of value) {
    const item = record(input);
    const title = shortText(item.title, 200);
    if (!title) throw new Error("Every selected product needs a name.");
    const linkError = "Use a Macroalgae Farms product URL.";
    const url = httpsUrl(item.url, linkError);
    if (!["macroalgaefarms.com", "www.macroalgaefarms.com"].includes(url.host) ||
      !/^\/products\/[a-z0-9-]+\/?$/i.test(url.pathname)) throw new Error(linkError);
    const handle = url.pathname.split("/")[2].toLowerCase();
    if (seen.has(handle)) continue;
    seen.add(handle);
    cards.push({
      id: shortText(item.id, 100) || handle,
      title,
      url: url.href,
      ...(item.image ? { image: httpsUrl(item.image, "Use an HTTPS product image URL.").href } : {}),
      ...(item.variantLabel ? { variantLabel: shortText(item.variantLabel, 120) } : {}),
      ...(item.salePrice ? { salePrice: shortText(item.salePrice, 80) } : {}),
      ...(item.compareAtPrice ? { compareAtPrice: shortText(item.compareAtPrice, 80) } : {}),
      ...(item.showSalePrice === false ? { showSalePrice: false } : {}),
      ...(item.showCompareAtPrice === false ? { showCompareAtPrice: false } : {}),
    });
  }
  return cards;
}

export function normalizeMacroBlackFriday(source: Content): Content {
  if (typeof source.body !== "string" || source.body.length > 20000)
    throw new Error("Use up to 20,000 characters for the Black Friday subtext.");
  const design = record(source.macroBlackFriday);
  return {
    ...macroBlackFridayCampaignTemplate.content,
    body: source.body,
    preview: shortText(source.preview, 300),
    macroBlackFriday: {
      featuredProducts: productCards(design.featuredProducts, MACRO_BLACK_FRIDAY_FEATURED_LIMIT),
      gridProducts: productCards(design.gridProducts, MACRO_BLACK_FRIDAY_GRID_LIMIT),
    },
  };
}
