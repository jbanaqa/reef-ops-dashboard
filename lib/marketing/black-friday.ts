import products from "./black-friday-products.json";
import type { MarketingBrand } from "./brands";
import type { CampaignEmailProduct, Content } from "./rules";

const storefront = "https://coralsanonymous.com";
export const BLACK_FRIDAY_MAX_SECTIONS = 12;
export const BLACK_FRIDAY_MAX_SECTION_PRODUCTS = 8;
export const BLACK_FRIDAY_DAILY_PRODUCTS = 3;

export function blackFridayCampaignBrand(layout: unknown): MarketingBrand | undefined {
  if (layout === "black-friday") return "corals-anonymous";
  if (layout === "macro-black-friday") return "macroalgae-farms";
}

export type BlackFridayCollection = {
  id: string;
  title: string;
  subtitle?: string;
  linkLabel: string;
  linkUrl: string;
  products: CampaignEmailProduct[];
};

export type BlackFridayDesign = {
  dailyDealsUrl: string;
  dailyProducts: CampaignEmailProduct[];
  sections: BlackFridayCollection[];
};

export const blackFridayCampaignTemplate = {
  key: "corals-black-friday",
  name: "Black Friday Sale",
  subject: "Black Friday Sale at Corals Anonymous",
  content: {
    layout: "black-friday",
    template: "campaign-sale",
    heading: "Black Friday Sale",
    body: "Big savings on corals, anemones, and more!",
    preview: "Big savings on corals, anemones, and more!",
    button: "Shop all deals",
    url: storefront + "/collections/sale",
    showPostalAddress: false,
    blackFriday: {
      dailyDealsUrl: storefront + "/",
      dailyProducts: products.daily,
      sections: [
        { id: "anemones", title: "Anemones", linkLabel: "Shop anemones", linkUrl: storefront + "/collections/anemones", products: products.anemones },
        { id: "corals", title: "Corals", linkLabel: "Shop corals", linkUrl: storefront + "/collections/all-corals", products: products.corals },
        { id: "mysterious-creatures", title: "Mysterious Creatures", subtitle: "Unusual inverts for your reef.", linkLabel: "Shop mysterious creatures", linkUrl: storefront + "/collections/mysterious-creatures", products: products.creatures },
      ],
    },
  } satisfies Content,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function shortText(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
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

function shopUrl(value: unknown, path?: RegExp) {
  const message = path?.source.includes("collections")
    ? "Use a Corals Anonymous collection URL for the section link."
    : "Use a Corals Anonymous storefront URL.";
  const url = httpsUrl(value, message);
  if (!["coralsanonymous.com", "www.coralsanonymous.com"].includes(url.host) || (path && !path.test(url.pathname)))
    throw new Error(message);
  return url.href;
}

function productCards(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  if (value.length > limit) throw new Error(`Choose up to ${limit} products for this section.`);
  const seen = new Set<string>();
  const cards: CampaignEmailProduct[] = [];
  for (const data of value) {
    const item = record(data);
    const title = shortText(item.title, 200);
    if (!title) throw new Error("Every selected product needs a name.");
    const url = shopUrl(item.url, /^\/products\/[a-z0-9-]+\/?$/i);
    const handle = new URL(url).pathname.split("/")[2].toLowerCase();
    if (seen.has(handle)) continue;
    seen.add(handle);
    cards.push({
      id: shortText(item.id, 100) || handle,
      title,
      url,
      ...(item.image ? { image: httpsUrl(item.image, "Use an HTTPS product image URL.").href } : {}),
      ...(item.salePrice ? { salePrice: shortText(item.salePrice, 80) } : {}),
      ...(item.compareAtPrice ? { compareAtPrice: shortText(item.compareAtPrice, 80) } : {}),
      ...(item.button ? { button: shortText(item.button, 80) } : {}),
      ...(item.showSalePrice === false ? { showSalePrice: false } : {}),
      ...(item.showCompareAtPrice === false ? { showCompareAtPrice: false } : {}),
      ...(item.showButton === false ? { showButton: false } : {}),
    });
  }
  return cards;
}

export function normalizeBlackFriday(value: unknown): BlackFridayDesign {
  const design = record(value);
  const sections: unknown[] = Array.isArray(design.sections) ? design.sections : [];
  if (sections.length > BLACK_FRIDAY_MAX_SECTIONS)
    throw new Error(`Use up to ${BLACK_FRIDAY_MAX_SECTIONS} collection sections.`);
  const ids = new Set<string>();
  return {
    dailyDealsUrl: shopUrl(design.dailyDealsUrl || storefront + "/"),
    dailyProducts: productCards(design.dailyProducts, BLACK_FRIDAY_DAILY_PRODUCTS),
    sections: sections.map((value, index) => {
      const section = record(value);
      let id = shortText(section.id, 80) || `collection-${index + 1}`;
      while (ids.has(id)) id += "-copy";
      ids.add(id);
      const subtitle = shortText(section.subtitle, 160);
      return {
        id,
        title: shortText(section.title, 100),
        ...(subtitle ? { subtitle } : {}),
        linkLabel: shortText(section.linkLabel, 100),
        linkUrl: section.linkUrl ? shopUrl(section.linkUrl, /^\/collections\/[a-z0-9-]+\/?$/i) : "",
        products: productCards(section.products, BLACK_FRIDAY_MAX_SECTION_PRODUCTS),
      };
    }),
  };
}

export function validateBlackFridayCampaign(source: Content) {
  if (source.layout !== "black-friday" || !source.blackFriday) return;
  const { dailyProducts, sections } = source.blackFriday;
  if (dailyProducts.length !== BLACK_FRIDAY_DAILY_PRODUCTS)
    throw new Error("Choose three products for Daily Super Deals before sending.");
  for (const section of sections) {
    if (!section.title || !section.products.length)
      throw new Error("Add a heading and at least one product to each collection section.");
    if (!!section.linkLabel !== !!section.linkUrl)
      throw new Error(`Add both the link text and collection URL for ${section.title}, or leave both blank.`);
  }
}

export function validateBlackFridayEmailSize(html: string) {
  // Leave space for the sender's link rewriting below the inbox clipping limit.
  if (new TextEncoder().encode(html).length > 90 * 1024)
    throw new Error("This email is too long. Remove some products or collection sections before sending.");
}

export function blackFridaySalePrice(product: CampaignEmailProduct) {
  return product.showSalePrice === false ? "" : (product.salePrice ?? "").replace(/^from\s+/i, "");
}

export function blackFridayPlainText(source: Content, unsubscribe: string, address: string, organizationName: string) {
  const design = source.blackFriday;
  if (!design) return "";
  const productLines = (items: CampaignEmailProduct[]) => items.map((item) => [
    item.title,
    blackFridaySalePrice(item),
    item.showCompareAtPrice === false || !item.compareAtPrice ? "" : "Was " + item.compareAtPrice,
    item.url,
  ].filter(Boolean).join(" · "));
  return [
    "Black Friday Sale · Up to 85% off select items",
    "Big savings on corals, anemones, and more!",
    `Shop all deals: ${source.url}`,
    `Daily Super Deals refresh at midnight Pacific. See current deals: ${design.dailyDealsUrl}`,
    ...productLines(design.dailyProducts),
    ...design.sections.flatMap((section) => [
      section.title,
      section.subtitle,
      ...productLines(section.products),
      section.linkLabel && section.linkUrl ? `${section.linkLabel}: ${section.linkUrl}` : "",
    ]),
    `Shop all deals: ${source.url}`,
    organizationName,
    address,
    `Unsubscribe: ${unsubscribe}`,
  ].filter(Boolean).join("\n\n");
}
