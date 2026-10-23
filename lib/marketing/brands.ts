import type { Content } from "./rules";

export const marketingBrands = [
  { id: "corals-anonymous", name: "Corals Anonymous", storefrontOrigin: "https://coralsanonymous.com", accent: "#245d92" },
  { id: "macroalgae-farms", name: "Macroalgae Farms", storefrontOrigin: "https://macroalgaefarms.com", accent: "#277a57" },
] as const;
export type MarketingBrand = (typeof marketingBrands)[number]["id"];
export type MarketingBrandDescriptor = (typeof marketingBrands)[number];

export function marketingBrand(value?: unknown): MarketingBrandDescriptor {
  if (value === undefined || value === null) return marketingBrands[0];
  const brand = marketingBrands.find((item) => item.id === value);
  if (!brand) throw new Error("Choose Corals Anonymous or Macroalgae Farms.");
  return brand;
}

export const defaultMacroCampaignContent: Content = {
  heading: "Fresh finds from Macroalgae Farms",
  body: "Explore the latest arrivals at Macroalgae Farms.",
  preview: "Find something new for your aquarium.",
  button: "Shop macroalgae",
  url: "https://macroalgaefarms.com",
  template: "campaign-sale",
  footerTitle: "Thank you for growing with us",
  footerText: "Macroalgae Farms",
  footerBackgroundColor: "#225d43",
  footerTextColor: "#ffffff",
  campaignLayout: {
    heroLink: "https://macroalgaefarms.com/collections/all",
    navigation: [{ label: "Shop Macroalgae", url: "https://macroalgaefarms.com/collections/all" }],
    sections: [
      { id: "macro-latest-products", type: "products", products: [], feed: {
        key: "newnew1", name: "Newest products", tags: [], order: "newest", limit: 6,
      } },
      { id: "macro-shop-button", type: "cta", label: "Shop Macroalgae Farms", url: "https://macroalgaefarms.com/collections/all", backgroundColor: "#277a57", textColor: "#ffffff" },
    ],
    style: { fontFamily: "Arial", emailBackground: "#eff6f1", contentBackground: "#ffffff", textColor: "#173b2d", salePriceColor: "#277a57", buttonBackground: "#277a57", buttonTextColor: "#ffffff", productAlignment: "center", productGap: 18, sectionPadding: 18, productImageWidth: 140, buttonRadius: 5, titleSize: 18, priceSize: 21 },
  },
};
