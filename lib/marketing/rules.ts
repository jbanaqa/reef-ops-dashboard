import { FilterXSS } from "xss";
import { decode } from "he";
import { firstWelcomeBody, firstWelcomeBodyHtml } from "./welcome-copy";
export const channels = [
  "EMAIL",
  "SMS_MARKETING",
  "SMS_TRANSACTIONAL",
] as const;
export type Channel = (typeof channels)[number];
export const emailLayouts = [
  "standard",
  "b2b-wholesale",
  "cart-recovery",
  "welcome",
  "welcome-social",
  "campaign-sale",
] as const;
export type EmailLayout = (typeof emailLayouts)[number];
export type CampaignEmailProduct = {
  id: string;
  title: string;
  url: string;
  image?: string;
  salePrice?: string;
  compareAtPrice?: string;
  button?: string;
  showSalePrice?: boolean;
  showCompareAtPrice?: boolean;
  showButton?: boolean;
  imageWidth?: number;
};
export const campaignProductFeeds = [
  {
    key: "anniversarysalesale",
    name: "Sale product feed",
    description: "General sale products tagged A50, A55, A60, or A65. Random order.",
    tags: ["A50", "A55", "A60", "A65"],
    order: "random",
    limit: 6,
  },
  {
    key: "newnewdiscount",
    name: "New discounts",
    description: "Products tagged AW50, AW55, AW60, or AW65. Newest first.",
    tags: ["AW50", "AW55", "AW60", "AW65"],
    order: "newest",
    limit: 12,
  },
  {
    key: "newnew1",
    name: "Newest products",
    description: "Products from all categories. Newest first.",
    tags: [],
    order: "newest",
    limit: 12,
  },
] as const;
export type CampaignProductFeedKey = (typeof campaignProductFeeds)[number]["key"];
export const campaignProductFeedOrders = [
  { value: "random", label: "Random" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "best-selling", label: "Best selling · last 3 days" },
  { value: "most-viewed", label: "Most viewed · last 3 days" },
  { value: "price-low", label: "Price · low to high" },
  { value: "price-high", label: "Price · high to low" },
  { value: "title-asc", label: "Product name · A to Z" },
  { value: "title-desc", label: "Product name · Z to A" },
] as const;
export type CampaignProductFeedOrder =
  (typeof campaignProductFeedOrders)[number]["value"];
export type CampaignProductFeed = {
  key: CampaignProductFeedKey;
  name: string;
  tags: string[];
  order: CampaignProductFeedOrder;
  limit: number;
};
export function campaignProductFeed(value: unknown): CampaignProductFeed | undefined {
  const candidate = value as
    | { key?: unknown; order?: unknown; limit?: unknown }
    | null;
  const key = String(candidate?.key || "");
  const saved = campaignProductFeeds.find((feed) => feed.key === key);
  const requestedOrder = String(candidate?.order || "");
  const order = campaignProductFeedOrders.some(
    (option) => option.value === requestedOrder,
  )
    ? (requestedOrder as CampaignProductFeedOrder)
    : saved?.order;
  const requestedLimit = Number(candidate?.limit);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(40, Math.max(1, requestedLimit))
    : saved?.limit;
  return saved
    ? {
        key: saved.key,
        name: saved.name,
        tags: [...saved.tags],
        order: order!,
        limit: limit!,
      }
    : undefined;
}
export type CampaignEmailSection =
  | {
      id: string;
      type: "products";
      backgroundColor?: string;
      feed?: CampaignProductFeed;
      products: CampaignEmailProduct[];
    }
  | {
      id: string;
      type: "cta";
      label: string;
      url: string;
      backgroundColor?: string;
      textColor?: string;
    }
  | {
      id: string;
      type: "banner";
      text: string;
      accent?: string;
      url: string;
      backgroundColor?: string;
      textColor?: string;
      accentColor?: string;
      accentPill?: boolean;
      borderColor?: string;
      borderWidth?: number;
    };
export type CampaignEmailLayout = {
  heroLink?: string;
  navigation: { label: string; url: string }[];
  sections: CampaignEmailSection[];
  style: {
    fontFamily: "Arial" | "Verdana" | "Georgia" | "Trebuchet MS";
    emailBackground: string;
    contentBackground: string;
    textColor: string;
    salePriceColor: string;
    buttonBackground: string;
    buttonTextColor: string;
    productAlignment: "left" | "center" | "right";
    productGap: number;
    sectionPadding: number;
    productImageWidth: number;
    buttonRadius: number;
    titleSize: number;
    priceSize: number;
  };
};
export type ProductGridStyle = CampaignEmailLayout["style"] & {
  showButton: boolean;
  buttonLabel: string;
};
export const defaultProductGridStyle: ProductGridStyle = {
  fontFamily: "Arial",
  emailBackground: "#fff7f5",
  contentBackground: "#ffffff",
  textColor: "#080808",
  salePriceColor: "#e84218",
  buttonBackground: "#79e93c",
  buttonTextColor: "#000000",
  productAlignment: "center",
  productGap: 18,
  sectionPadding: 18,
  productImageWidth: 140,
  buttonRadius: 5,
  titleSize: 18,
  priceSize: 21,
  showButton: true,
  buttonLabel: "Shop now",
};
export type Content = {
  heading: string;
  body: string;
  bodyHtml?: string;
  introText?: string;
  button: string;
  url: string;
  hero?: string;
  showCartOceanTexture?: boolean;
  cartHeroTextSize?: number;
  cartHeroBandColor?: string;
  cartHeroButtonWidth?: number;
  preview?: string;
  template?:
    | "standard"
    | "b2b-wholesale"
    | "cart-recovery"
    | "welcome"
    | "welcome-social"
    | "campaign-sale";
  /** Visual presentation. The template continues to describe dynamic flow behavior. */
  layout?: EmailLayout;
  couponCode?: string;
  couponExpiresAt?: string;
  offerAboveBody?: boolean;
  logo?: string;
  logoScale?: number;
  footerImage?: string;
  footerScale?: number;
  footerBackgroundColor?: string;
  footerTextColor?: string;
  footerTitle?: string;
  showPostalAddress?: boolean;
  showFooterSocial?: boolean;
  footerText?: string;
  footerSocialHeading?: string;
  footerUnsubscribeText?: string;
  footerUnsubscribeLinkText?: string;
  showFooterCopyright?: boolean;
  footerCopyrightText?: string;
  couponLabel?: string;
  couponTerms?: string;
  couponExpiryText?: string;
  couponExpiryFallbackText?: string;
  welcomeHeroGreeting?: string;
  welcomeHeroText?: string;
  showWelcomeIllustration?: boolean;
  socialFollowText?: string;
  instagramHeading?: string;
  instagramHandle?: string;
  instagramText?: string;
  facebookHeading?: string;
  facebookHandle?: string;
  facebookText?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  instagramIcon?: string;
  facebookIcon?: string;
  /** @deprecated Older saved flows may still contain these pixel values. */ logoWidth?: number;
  logoHeight?: number;
  footerWidth?: number;
  footerHeight?: number;
  products?: {
    title: string;
    url: string;
    image?: string;
    price?: string;
    compareAtPrice?: string;
  }[];
  productGridStyle?: ProductGridStyle;
  campaignLayout?: CampaignEmailLayout;
};
export type MarketingOperations = {
  sendingEnabled: boolean;
  migrationConfirmed: boolean;
  ingestEnabled: boolean;
  formEnabled: boolean;
};
export type EmailBranding = {
  logo?: string;
  logoScale?: number;
  footerConfigured?: boolean;
  footerImage?: string;
  footerScale?: number;
  footerBackgroundColor?: string;
  footerTextColor?: string;
  footerTitle?: string;
  footerText?: string;
  footerSocialHeading?: string;
  footerUnsubscribeText?: string;
  footerUnsubscribeLinkText?: string;
  footerCopyrightText?: string;
  showPostalAddress?: boolean;
  showFooterSocial?: boolean;
  showFooterCopyright?: boolean;
  instagramUrl?: string;
  facebookUrl?: string;
  instagramIcon?: string;
  facebookIcon?: string;
};
export const sharedFooterContentKeys = [
  "footerImage",
  "footerScale",
  "footerBackgroundColor",
  "footerTextColor",
  "footerTitle",
  "footerText",
  "footerSocialHeading",
  "footerUnsubscribeText",
  "footerUnsubscribeLinkText",
  "footerCopyrightText",
  "showPostalAddress",
  "showFooterSocial",
  "showFooterCopyright",
  "instagramUrl",
  "facebookUrl",
  "instagramIcon",
  "facebookIcon",
] as const satisfies readonly (keyof Content)[];
export type SharedFooterContentKey =
  (typeof sharedFooterContentKeys)[number];
const sharedFooterContentKeySet = new Set<keyof Content>(
  sharedFooterContentKeys,
);
export function isSharedFooterContentKey(
  key: keyof Content,
): key is SharedFooterContentKey {
  return sharedFooterContentKeySet.has(key);
}
export function editSharedEmailFooter(
  branding: EmailBranding,
  key: SharedFooterContentKey,
  value: Content[keyof Content],
): EmailBranding {
  return {
    ...branding,
    footerConfigured: true,
    [key]: value,
  } as EmailBranding;
}
export type MarketingSettings = {
  postalAddress: string;
  organizationName: string;
  branding: EmailBranding;
  operations: MarketingOperations;
  popupDismissalDays: number;
  popupDelaySeconds: number;
  attribution: {
    emailClickDays: number;
    emailOpenDays: number;
  };
};
export const defaultMarketingSettings: MarketingSettings = {
  postalAddress: "",
  organizationName: "Corals Anonymous",
  branding: {},
  popupDismissalDays: 7,
  popupDelaySeconds: 10,
  attribution: {
    emailClickDays: 5,
    emailOpenDays: 5,
  },
  operations: {
    sendingEnabled: false,
    migrationConfirmed: false,
    ingestEnabled: false,
    formEnabled: false,
  },
};
const envFlag = (name: string) => process.env[name] === "true";
export function marketingSettings(
  value: unknown,
  fallbackAddress = process.env.MARKETING_POSTAL_ADDRESS ||
    defaultMarketingSettings.postalAddress,
): MarketingSettings {
  const v = (value || {}) as Partial<MarketingSettings> &
    Partial<MarketingOperations>;
  const saved = (v.operations || {}) as Partial<MarketingOperations>;
  const branding = (v.branding || {}) as Partial<EmailBranding>;
  const requestedDismissalDays = Number(v.popupDismissalDays ?? 7);
  const requestedDelaySeconds = Number(v.popupDelaySeconds ?? 10);
  const requestedAttribution = (v.attribution || {}) as Partial<
    MarketingSettings["attribution"]
  >;
  const attributionDays = (value: unknown, fallback: number) => {
    const n = Number(value ?? fallback);
    return Number.isInteger(n) && n >= 1 && n <= 90 ? n : fallback;
  };
  const brandingImage = (value: unknown) =>
    value ? imageSource(value) : undefined;
  const brandingScale = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n)
      ? Math.min(2.5, Math.max(0.25, Math.round(n * 20) / 20))
      : undefined;
  };
  return {
    postalAddress: String(v.postalAddress ?? fallbackAddress).slice(0, 500),
    organizationName: String(
      v.organizationName || defaultMarketingSettings.organizationName,
    ).slice(0, 120),
    popupDismissalDays:
      Number.isInteger(requestedDismissalDays) &&
      requestedDismissalDays >= 0 &&
      requestedDismissalDays <= 30
        ? requestedDismissalDays
        : 7,
    popupDelaySeconds:
      Number.isInteger(requestedDelaySeconds) &&
      requestedDelaySeconds >= 0 &&
      requestedDelaySeconds <= 300
        ? requestedDelaySeconds
        : 10,
    attribution: {
      emailClickDays: attributionDays(
        requestedAttribution.emailClickDays,
        defaultMarketingSettings.attribution.emailClickDays,
      ),
      emailOpenDays: attributionDays(
        requestedAttribution.emailOpenDays,
        defaultMarketingSettings.attribution.emailOpenDays,
      ),
    },
    branding: {
      ...(branding.footerConfigured === true
        ? { footerConfigured: true }
        : {}),
      ...(brandingImage(branding.logo)
        ? { logo: brandingImage(branding.logo) }
        : {}),
      ...(brandingScale(branding.logoScale)
        ? { logoScale: brandingScale(branding.logoScale) }
        : {}),
      ...(brandingImage(branding.footerImage)
        ? { footerImage: brandingImage(branding.footerImage) }
        : {}),
      ...(brandingScale(branding.footerScale)
        ? { footerScale: brandingScale(branding.footerScale) }
        : {}),
      ...(branding.footerBackgroundColor
        ? {
            footerBackgroundColor: /^#[0-9a-f]{6}$/i.test(
              branding.footerBackgroundColor,
            )
              ? branding.footerBackgroundColor
              : "#244b7b",
          }
        : {}),
      ...(branding.footerTextColor
        ? {
            footerTextColor: /^#[0-9a-f]{6}$/i.test(branding.footerTextColor)
              ? branding.footerTextColor
              : "#ffffff",
          }
        : {}),
      ...(branding.footerTitle !== undefined
        ? { footerTitle: String(branding.footerTitle).slice(0, 200) }
        : {}),
      ...(branding.footerText !== undefined
        ? { footerText: String(branding.footerText).slice(0, 2000) }
        : {}),
      ...(branding.footerSocialHeading !== undefined
        ? {
            footerSocialHeading: String(branding.footerSocialHeading).slice(
              0,
              100,
            ),
          }
        : {}),
      ...(branding.footerUnsubscribeText !== undefined
        ? {
            footerUnsubscribeText: String(
              branding.footerUnsubscribeText,
            ).slice(0, 300),
          }
        : {}),
      ...(branding.footerUnsubscribeLinkText !== undefined
        ? {
            footerUnsubscribeLinkText: String(
              branding.footerUnsubscribeLinkText,
            ).slice(0, 100),
          }
        : {}),
      ...(branding.footerCopyrightText !== undefined
        ? {
            footerCopyrightText: String(branding.footerCopyrightText).slice(
              0,
              300,
            ),
          }
        : {}),
      ...(typeof branding.showPostalAddress === "boolean"
        ? { showPostalAddress: branding.showPostalAddress }
        : {}),
      ...(typeof branding.showFooterSocial === "boolean"
        ? { showFooterSocial: branding.showFooterSocial }
        : {}),
      ...(typeof branding.showFooterCopyright === "boolean"
        ? { showFooterCopyright: branding.showFooterCopyright }
        : {}),
      ...(branding.instagramUrl
        ? { instagramUrl: safeUrl(branding.instagramUrl).slice(0, 500) }
        : {}),
      ...(branding.facebookUrl
        ? { facebookUrl: safeUrl(branding.facebookUrl).slice(0, 500) }
        : {}),
      ...(brandingImage(branding.instagramIcon)
        ? { instagramIcon: brandingImage(branding.instagramIcon) }
        : {}),
      ...(brandingImage(branding.facebookIcon)
        ? { facebookIcon: brandingImage(branding.facebookIcon) }
        : {}),
    },
    operations: {
      sendingEnabled:
        typeof saved.sendingEnabled === "boolean"
          ? saved.sendingEnabled
          : typeof v.sendingEnabled === "boolean"
            ? v.sendingEnabled
            : envFlag("MARKETING_SEND_ENABLED"),
      migrationConfirmed:
        typeof saved.migrationConfirmed === "boolean"
          ? saved.migrationConfirmed
          : typeof v.migrationConfirmed === "boolean"
            ? v.migrationConfirmed
            : envFlag("MARKETING_MIGRATION_CONFIRMED"),
      ingestEnabled:
        typeof saved.ingestEnabled === "boolean"
          ? saved.ingestEnabled
          : typeof v.ingestEnabled === "boolean"
            ? v.ingestEnabled
            : envFlag("MARKETING_INGEST_ENABLED"),
      formEnabled:
        typeof saved.formEnabled === "boolean"
          ? saved.formEnabled
          : typeof v.formEnabled === "boolean"
            ? v.formEnabled
            : envFlag("MARKETING_FORM_ENABLED"),
    },
  };
}
export type Segment = {
  openedDays?: number;
  tag?: string;
  list?: string;
  purchasedDays?: number;
  excludePurchasedDays?: number;
};
export const DAY = 86400000;
export function email(value: unknown) {
  const result = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(result) || result.length > 254)
    throw new Error("Enter a valid email address.");
  return result;
}
export function phone(value: unknown) {
  const result = String(value || "").replace(/[ ()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(result))
    throw new Error("Use an international phone number, such as +15551234567.");
  return result;
}
export function date(value: unknown) {
  const result = new Date(String(value));
  if (!Number.isFinite(result.getTime())) throw new Error("Invalid date.");
  return result;
}
export function imageSource(value: unknown) {
  const result = String(value || "");
  if (!result) return undefined;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(result)) {
    if (result.length > 5000000)
      throw new Error("Images must be smaller than 5 MB.");
    return result;
  }
  return safeUrl(result);
}
export function safeUrl(value: unknown) {
  const url = new URL(String(value));
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Links and images must use HTTPS.");
  return url.href;
}
const emailHtmlFilter = new FilterXSS({
  whiteList: {
    p: ["style"],
    br: [],
    div: ["style"],
    span: ["style"],
    strong: ["style"],
    b: [],
    em: [],
    i: [],
    u: [],
    a: ["href", "style"],
    ul: ["style"],
    ol: ["style"],
    li: ["style"],
    h1: ["style"],
    h2: ["style"],
    h3: ["style"],
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ["script", "style", "iframe", "object", "svg", "math"],
  onTagAttr(_tag, name, value) {
    if (name === "href") {
      try {
        return (
          'href="' +
          escapeHtml(safeUrl(decode(value, { isAttributeValue: true }))) +
          '"'
        );
      } catch {
        return 'href="#"';
      }
    }
  },
});
export function sanitizeEmailHtml(value: unknown) {
  return emailHtmlFilter.process(String(value || "").slice(0, 30000));
}
export function htmlText(html: string) {
  return decode(
    sanitizeEmailHtml(html)
      .replace(
        /<a\b[^>]*href="(https:[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
        "$2 ($1)",
      )
      .replace(/<br\s*\/?>|<\/(?:p|div|h[123]|li)>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  ).trim();
}
export function personalize(value: string, name = "", html = false) {
  const first = name.trim().split(/\s+/)[0];
  return value.replace(
    /\{\{\s*first_name\s*\|\s*default\s*:["']([^"']+)["']\s*\}\}/gi,
    (_match, fallback: string) =>
      html ? escapeHtml(first || fallback) : first || fallback,
  );
}
export function textBody(c: Content, name = "") {
  return personalize(
    (c.bodyHtml !== undefined ? htmlText(c.bodyHtml) : c.body).replaceAll(
      "{{ coupon_expires }}",
      c.couponExpiresAt ||
        c.couponExpiryFallbackText ||
        defaultGeneratedEmailCopy.couponExpiryFallback,
    ),
    name,
  );
}
export function withCoupon(c: Content, code: string): Content {
  const line = "Your first-order 10% discount code: " + code;
  return {
    ...c,
    body: c.body + "\n" + line,
    ...(c.bodyHtml
      ? { bodyHtml: c.bodyHtml + "<p>" + escapeHtml(line) + "</p>" }
      : {}),
  };
}
function productHtml(c: Content) {
  return (c.products || [])
    .map(
      (p) =>
        '<div style="padding:18px 0;border-top:1px solid #ddd"><a href="' +
        escapeHtml(p.url) +
        '">' +
        (p.image
          ? '<img src="' +
            escapeHtml(p.image) +
            '" width="240" style="max-width:100%" alt="' +
            escapeHtml(p.title) +
            '"><br>'
          : "") +
        escapeHtml(p.title) +
        "</a>" +
        (p.price ? "<p>" + escapeHtml(p.price) + "</p>" : "") +
        "</div>",
    )
    .join("");
}
function productGridHtml(
  products: CampaignEmailProduct[],
  style: CampaignEmailLayout["style"],
  className: string,
) {
  if (!products.length) return "";
  const rows: string[] = [];
  for (let i = 0; i < products.length; i += 2) {
    const cells = products.slice(i, i + 2).map((product) => {
      const imageWidth = product.imageWidth || style.productImageWidth;
      const imageMargin =
        style.productAlignment === "center"
          ? "0 auto 10px"
          : style.productAlignment === "right"
            ? "0 0 10px auto"
            : "0 auto 10px 0";
      const price = product.showSalePrice !== false && product.salePrice
        ? '<span style="color:' + escapeHtml(style.salePriceColor) + ";font-size:" + style.priceSize + 'px;font-weight:bold">' + escapeHtml(product.salePrice) + "</span>"
        : "";
      const compare = product.showCompareAtPrice !== false && product.compareAtPrice
        ? ' <span style="color:' + escapeHtml(style.textColor) + ';font-size:13px;text-decoration:line-through">' + escapeHtml(product.compareAtPrice) + "</span>"
        : "";
      const button = product.showButton !== false
        ? '<div style="margin-top:13px"><a href="' + escapeHtml(product.url) + '" style="display:inline-block;background:' + escapeHtml(style.buttonBackground) + ";color:" + escapeHtml(style.buttonTextColor) + ";border-radius:" + style.buttonRadius + 'px;padding:10px 14px;font-size:16px;font-weight:bold;text-decoration:none">' + escapeHtml(product.button ?? "Shop now") + "</a></div>"
        : "";
      return (
        '<td class="reef-product-card ' + className + '" valign="top" width="50%" style="width:50%;padding:' +
        Math.round(style.productGap / 2) + "px;text-align:" + style.productAlignment + ";color:" + escapeHtml(style.textColor) +
        '"><a href="' + escapeHtml(product.url) + '" style="color:' + escapeHtml(style.textColor) + ';text-decoration:none">' +
        (product.image
          ? '<img src="' + escapeHtml(product.image) + '" alt="' + escapeHtml(product.title) + '" width="' + imageWidth + '" style="display:block;width:' + imageWidth + 'px;max-width:100%;height:auto;margin:' + imageMargin + '">'
          : '<div style="width:' + imageWidth + "px;max-width:100%;height:" + imageWidth + "px;background:#f1f3f3;margin:" + imageMargin + '">&nbsp;</div>') +
        '<strong style="display:block;font-size:' + style.titleSize + 'px;line-height:1.2">' + escapeHtml(product.title) +
        '</strong></a><div style="margin-top:8px">' + price + compare + "</div>" + button + "</td>"
      );
    });
    if (cells.length === 1)
      cells.push(
        '<td class="reef-product-card ' + className + '" width="50%" style="width:50%">&nbsp;</td>',
      );
    rows.push("<tr>" + cells.join("") + "</tr>");
  }
  return rows.join("");
}
export function productGridStyle(c: Content): ProductGridStyle {
  return { ...defaultProductGridStyle, ...(c.productGridStyle || {}) };
}
function cartProductHtml(c: Content) {
  const style = productGridStyle(c);
  const products = (c.products || []).map((product, index) => ({
    id: "cart-product-" + index,
    title: product.title,
    url: product.url,
    image: product.image,
    salePrice: product.price,
    compareAtPrice: product.compareAtPrice,
    showCompareAtPrice: true,
    showButton: style.showButton,
    button: style.buttonLabel,
  }));
  if (!products.length) return "";
  return (
    '<table role="presentation" class="reef-cart-products" width="100%" style="width:100%;border-collapse:collapse;table-layout:fixed;border-top:1px solid #71cbd2;margin-top:18px;background:' +
    escapeHtml(style.contentBackground) + ";font-family:" + escapeHtml(style.fontFamily) +
    ',Arial,sans-serif"><tbody>' +
    productGridHtml(products, style, "reef-cart-product") +
    "</tbody></table>"
  );
}
export function content(value: unknown): Content {
  if (!value || typeof value !== "object")
    throw new Error("Message content is required.");
  const c = value as Content;
  if (!c.heading?.trim() || !c.body?.trim() || c.body.length > 20000)
    throw new Error("Add a heading and message (up to 20,000 characters).");
  const scale = (value: unknown, legacyWidth: unknown, base: number) => {
    const fallback = legacyWidth != null ? Number(legacyWidth) / base : 1;
    const n = Number(value);
    return Number.isFinite(n)
      ? Math.min(2.5, Math.max(0.25, Math.round(n * 10) / 10))
      : Math.min(2.5, Math.max(0.25, Math.round(fallback * 10) / 10));
  };
  const color = (value: unknown, fallback: string) => {
    const result = String(value || fallback).trim();
    return /^#[0-9a-f]{6}$/i.test(result) ? result : fallback;
  };
  const bounded = (value: unknown, fallback: number, min: number, max: number) => {
    const result = Number(value);
    return Number.isFinite(result)
      ? Math.min(max, Math.max(min, Math.round(result)))
      : fallback;
  };
  const rawProductGridStyle =
    c.productGridStyle || (c.template === "cart-recovery" ? defaultProductGridStyle : undefined);
  const normalizedProductGridStyle: ProductGridStyle | undefined = rawProductGridStyle
    ? {
        fontFamily: (["Arial", "Verdana", "Georgia", "Trebuchet MS"] as const).includes(
          rawProductGridStyle.fontFamily,
        )
          ? rawProductGridStyle.fontFamily
          : defaultProductGridStyle.fontFamily,
        emailBackground: color(rawProductGridStyle.emailBackground, defaultProductGridStyle.emailBackground),
        contentBackground: color(rawProductGridStyle.contentBackground, defaultProductGridStyle.contentBackground),
        textColor: color(rawProductGridStyle.textColor, defaultProductGridStyle.textColor),
        salePriceColor: color(rawProductGridStyle.salePriceColor, defaultProductGridStyle.salePriceColor),
        buttonBackground: color(rawProductGridStyle.buttonBackground, defaultProductGridStyle.buttonBackground),
        buttonTextColor: color(rawProductGridStyle.buttonTextColor, defaultProductGridStyle.buttonTextColor),
        productAlignment: ["left", "center", "right"].includes(rawProductGridStyle.productAlignment)
          ? rawProductGridStyle.productAlignment
          : defaultProductGridStyle.productAlignment,
        productGap: bounded(rawProductGridStyle.productGap, defaultProductGridStyle.productGap, 0, 60),
        sectionPadding: bounded(rawProductGridStyle.sectionPadding, defaultProductGridStyle.sectionPadding, 0, 60),
        productImageWidth: bounded(rawProductGridStyle.productImageWidth, defaultProductGridStyle.productImageWidth, 60, 280),
        buttonRadius: bounded(rawProductGridStyle.buttonRadius, defaultProductGridStyle.buttonRadius, 0, 40),
        titleSize: bounded(rawProductGridStyle.titleSize, defaultProductGridStyle.titleSize, 11, 32),
        priceSize: bounded(rawProductGridStyle.priceSize, defaultProductGridStyle.priceSize, 11, 34),
        showButton: rawProductGridStyle.showButton !== false,
        buttonLabel: String(rawProductGridStyle.buttonLabel || defaultProductGridStyle.buttonLabel).slice(0, 80),
      }
    : undefined;
  const rawLayout = c.campaignLayout;
  const campaignLayout: CampaignEmailLayout | undefined = rawLayout
    ? {
        heroLink: rawLayout.heroLink
          ? safeUrl(rawLayout.heroLink).slice(0, 500)
          : undefined,
        navigation: (rawLayout.navigation || []).slice(0, 5).map((item) => ({
          label: String(item.label ?? "Link").slice(0, 80),
          url: safeUrl(item.url).slice(0, 500),
        })),
        sections: (rawLayout.sections || []).slice(0, 20).map((section, index) => {
          if (section.type === "banner")
            return {
              id: String(section.id || `banner-${index}`).slice(0, 100),
              type: "banner" as const,
              text: String(section.text ?? "Promotional banner").slice(0, 200),
              accent: String(section.accent || "").slice(0, 80) || undefined,
              url: safeUrl(section.url).slice(0, 500),
              backgroundColor: color(section.backgroundColor, "#ffffff"),
              textColor: color(section.textColor, "#080808"),
              accentColor: color(section.accentColor, "#5439ee"),
              accentPill: section.accentPill === true,
              borderColor: color(section.borderColor, "#5439ee"),
              borderWidth: bounded(section.borderWidth, 0, 0, 8),
            };
          if (section.type === "cta")
            return {
              id: String(section.id || `cta-${index}`).slice(0, 100),
              type: "cta" as const,
              label: String(section.label ?? "Shop now").slice(0, 100),
              url: safeUrl(section.url).slice(0, 500),
              backgroundColor: color(section.backgroundColor, "#3c8429"),
              textColor: color(section.textColor, "#ffffff"),
            };
          return {
            id: String(section.id || `products-${index}`).slice(0, 100),
            type: "products" as const,
            backgroundColor: color(section.backgroundColor, "#ffffff"),
            feed: campaignProductFeed(section.feed),
            products: (section.products || []).slice(0, 40).map((product, productIndex) => ({
              id: String(product.id || `product-${index}-${productIndex}`).slice(0, 100),
              title: String(product.title ?? "Product name").slice(0, 200),
              url: safeUrl(product.url).slice(0, 500),
              image: product.image ? safeUrl(product.image).slice(0, 500) : undefined,
              salePrice: String(product.salePrice || "").slice(0, 80),
              compareAtPrice: String(product.compareAtPrice || "").slice(0, 80),
              button: String(product.button ?? "Shop now").slice(0, 80),
              showSalePrice: product.showSalePrice !== false,
              showCompareAtPrice: product.showCompareAtPrice !== false,
              showButton: product.showButton !== false,
              imageWidth: bounded(product.imageWidth, 0, 0, 280) || undefined,
            })),
          };
        }),
        style: {
          fontFamily: (["Arial", "Verdana", "Georgia", "Trebuchet MS"] as const).includes(
            rawLayout.style?.fontFamily,
          )
            ? rawLayout.style.fontFamily
            : "Arial",
          emailBackground: color(rawLayout.style?.emailBackground, "#fff7f5"),
          contentBackground: color(rawLayout.style?.contentBackground, "#ffffff"),
          textColor: color(rawLayout.style?.textColor, "#080808"),
          salePriceColor: color(rawLayout.style?.salePriceColor, "#e84218"),
          buttonBackground: color(rawLayout.style?.buttonBackground, "#79e93c"),
          buttonTextColor: color(rawLayout.style?.buttonTextColor, "#000000"),
          productAlignment: ["left", "center", "right"].includes(rawLayout.style?.productAlignment)
            ? rawLayout.style.productAlignment
            : "center",
          productGap: bounded(rawLayout.style?.productGap, 18, 0, 60),
          sectionPadding: bounded(rawLayout.style?.sectionPadding, 18, 0, 60),
          productImageWidth: bounded(rawLayout.style?.productImageWidth, 140, 60, 280),
          buttonRadius: bounded(rawLayout.style?.buttonRadius, 5, 0, 40),
          titleSize: bounded(rawLayout.style?.titleSize, 18, 11, 32),
          priceSize: bounded(rawLayout.style?.priceSize, 21, 11, 34),
        },
      }
    : undefined;
  return {
    showPostalAddress: c.showPostalAddress === true,
    showFooterSocial: c.showFooterSocial !== false,
    heading: c.heading.slice(0, 200),
    body: c.body,
    bodyHtml:
      c.bodyHtml !== undefined && c.bodyHtml !== null
        ? sanitizeEmailHtml(c.bodyHtml)
        : undefined,
    introText:
      c.introText === undefined
        ? undefined
        : String(c.introText).slice(0, 300),
    button: String(c.button ?? "Shop now").slice(0, 80),
    url: safeUrl(c.url),
    hero: c.hero ? imageSource(c.hero) : undefined,
    showCartOceanTexture: c.showCartOceanTexture !== false,
    cartHeroTextSize:
      c.cartHeroTextSize === undefined
        ? undefined
        : bounded(c.cartHeroTextSize, 32, 22, 42),
    cartHeroBandColor:
      c.cartHeroBandColor === undefined
        ? undefined
        : color(c.cartHeroBandColor, "#95dce5"),
    cartHeroButtonWidth:
      c.cartHeroButtonWidth === undefined
        ? undefined
        : bounded(c.cartHeroButtonWidth, 234, 140, 360),
    preview: String(c.preview || "").slice(0, 200),
    template:
      c.template === "welcome" || c.template === "welcome-social"
        ? c.template
        : c.template === "campaign-sale"
          ? "campaign-sale"
        : c.template === "cart-recovery"
          ? "cart-recovery"
          : c.template === "b2b-wholesale"
            ? "b2b-wholesale"
            : "standard",
    layout: emailLayouts.includes(c.layout as EmailLayout)
      ? (c.layout as EmailLayout)
      : undefined,
    couponCode: c.couponCode ? String(c.couponCode).slice(0, 100) : undefined,
    couponExpiresAt: c.couponExpiresAt
      ? new Date(c.couponExpiresAt).toISOString()
      : undefined,
    offerAboveBody: c.offerAboveBody === true,
    logo: c.logo ? imageSource(c.logo) : undefined,
    logoScale: c.logo ? scale(c.logoScale, c.logoWidth, 260) : undefined,
    footerImage: c.footerImage ? imageSource(c.footerImage) : undefined,
    footerBackgroundColor:
      c.footerBackgroundColor === undefined
        ? undefined
        : color(c.footerBackgroundColor, "#ffffff"),
    footerTextColor:
      c.footerTextColor === undefined
        ? undefined
        : color(c.footerTextColor, "#ffffff"),
    footerTitle:
      c.footerTitle === undefined
        ? undefined
        : String(c.footerTitle).slice(0, 200),
    footerText:
      c.footerText === undefined
        ? undefined
        : String(c.footerText).slice(0, 2000),
    footerSocialHeading:
      c.footerSocialHeading === undefined
        ? undefined
        : String(c.footerSocialHeading).slice(0, 100),
    footerUnsubscribeText:
      c.footerUnsubscribeText === undefined
        ? undefined
        : String(c.footerUnsubscribeText).slice(0, 300),
    footerUnsubscribeLinkText:
      c.footerUnsubscribeLinkText === undefined
        ? undefined
        : String(c.footerUnsubscribeLinkText).slice(0, 100),
    showFooterCopyright: c.showFooterCopyright !== false,
    footerCopyrightText:
      c.footerCopyrightText === undefined
        ? undefined
        : String(c.footerCopyrightText).slice(0, 300),
    couponLabel:
      c.couponLabel === undefined
        ? undefined
        : String(c.couponLabel).slice(0, 200),
    couponTerms:
      c.couponTerms === undefined
        ? undefined
        : String(c.couponTerms).slice(0, 500),
    couponExpiryText:
      c.couponExpiryText === undefined
        ? undefined
        : String(c.couponExpiryText).slice(0, 500),
    couponExpiryFallbackText:
      c.couponExpiryFallbackText === undefined
        ? undefined
        : String(c.couponExpiryFallbackText).slice(0, 200),
    welcomeHeroGreeting:
      c.welcomeHeroGreeting === undefined
        ? undefined
        : String(c.welcomeHeroGreeting).slice(0, 200),
    welcomeHeroText:
      c.welcomeHeroText === undefined
        ? undefined
        : String(c.welcomeHeroText).slice(0, 500),
    showWelcomeIllustration: c.showWelcomeIllustration !== false,
    socialFollowText:
      c.socialFollowText === undefined
        ? undefined
        : String(c.socialFollowText).slice(0, 100),
    instagramHeading:
      c.instagramHeading === undefined
        ? undefined
        : String(c.instagramHeading).slice(0, 100),
    instagramHandle:
      c.instagramHandle === undefined
        ? undefined
        : String(c.instagramHandle).slice(0, 100),
    instagramText:
      c.instagramText === undefined
        ? undefined
        : String(c.instagramText).slice(0, 300),
    facebookHeading:
      c.facebookHeading === undefined
        ? undefined
        : String(c.facebookHeading).slice(0, 100),
    facebookHandle:
      c.facebookHandle === undefined
        ? undefined
        : String(c.facebookHandle).slice(0, 100),
    facebookText:
      c.facebookText === undefined
        ? undefined
        : String(c.facebookText).slice(0, 300),
    instagramUrl: c.instagramUrl
      ? safeUrl(c.instagramUrl).slice(0, 500)
      : undefined,
    facebookUrl: c.facebookUrl
      ? safeUrl(c.facebookUrl).slice(0, 500)
      : undefined,
    instagramIcon: c.instagramIcon ? imageSource(c.instagramIcon) : undefined,
    facebookIcon: c.facebookIcon ? imageSource(c.facebookIcon) : undefined,
    footerScale: c.footerImage
      ? scale(c.footerScale, c.footerWidth, 560)
      : undefined,
    products: (c.products || []).slice(0, 12).map((p) => ({
      title: String(p.title).slice(0, 200),
      url: safeUrl(p.url),
      image: p.image ? safeUrl(p.image) : undefined,
      price: String(p.price || "").slice(0, 80),
      compareAtPrice: String(p.compareAtPrice || "").slice(0, 80),
    })),
    productGridStyle: normalizedProductGridStyle,
    campaignLayout,
  };
}
export function withBranding(c: Content, branding?: EmailBranding): Content {
  if (!branding) return c;
  const sharedFooter = branding.footerConfigured
    ? {
        footerImage: branding.footerImage,
        footerScale: branding.footerScale,
        footerBackgroundColor: branding.footerBackgroundColor,
        footerTextColor: branding.footerTextColor,
        footerTitle: branding.footerTitle,
        footerText: branding.footerText,
        footerSocialHeading: branding.footerSocialHeading,
        footerUnsubscribeText: branding.footerUnsubscribeText,
        footerUnsubscribeLinkText: branding.footerUnsubscribeLinkText,
        footerCopyrightText: branding.footerCopyrightText,
        showPostalAddress: branding.showPostalAddress,
        showFooterSocial: branding.showFooterSocial,
        showFooterCopyright: branding.showFooterCopyright,
        instagramUrl: branding.instagramUrl,
        facebookUrl: branding.facebookUrl,
        instagramIcon: branding.instagramIcon,
        facebookIcon: branding.facebookIcon,
      }
    : {};
  return {
    ...c,
    ...(c.logo === undefined && branding.logo ? { logo: branding.logo } : {}),
    ...(c.logoScale === undefined && branding.logoScale
      ? { logoScale: branding.logoScale }
      : {}),
    ...(c.footerImage === undefined && branding.footerImage
      ? { footerImage: branding.footerImage }
      : {}),
    ...(c.footerScale === undefined && branding.footerScale
      ? { footerScale: branding.footerScale }
      : {}),
    ...(c.instagramUrl === undefined && branding.instagramUrl
      ? { instagramUrl: branding.instagramUrl }
      : {}),
    ...(c.facebookUrl === undefined && branding.facebookUrl
      ? { facebookUrl: branding.facebookUrl }
      : {}),
    ...(c.instagramIcon === undefined && branding.instagramIcon
      ? { instagramIcon: branding.instagramIcon }
      : {}),
    ...(c.facebookIcon === undefined && branding.facebookIcon
      ? { facebookIcon: branding.facebookIcon }
      : {}),
    ...sharedFooter,
  };
}
export function extractEmailBranding(value: unknown): Partial<EmailBranding> {
  const found: Partial<EmailBranding> = {};
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const v = node as Record<string, unknown>;
    if (typeof v.logo === "string" && v.logo) found.logo = v.logo;
    if (typeof v.logoScale === "number") found.logoScale = v.logoScale;
    if (typeof v.footerImage === "string" && v.footerImage)
      found.footerImage = v.footerImage;
    if (typeof v.footerScale === "number") found.footerScale = v.footerScale;
    if (typeof v.footerBackgroundColor === "string")
      found.footerBackgroundColor = v.footerBackgroundColor;
    if (typeof v.footerTextColor === "string")
      found.footerTextColor = v.footerTextColor;
    if (typeof v.footerTitle === "string") found.footerTitle = v.footerTitle;
    if (typeof v.footerText === "string") found.footerText = v.footerText;
    if (typeof v.footerSocialHeading === "string")
      found.footerSocialHeading = v.footerSocialHeading;
    if (typeof v.footerUnsubscribeText === "string")
      found.footerUnsubscribeText = v.footerUnsubscribeText;
    if (typeof v.footerUnsubscribeLinkText === "string")
      found.footerUnsubscribeLinkText = v.footerUnsubscribeLinkText;
    if (typeof v.footerCopyrightText === "string")
      found.footerCopyrightText = v.footerCopyrightText;
    if (typeof v.showPostalAddress === "boolean")
      found.showPostalAddress = v.showPostalAddress;
    if (typeof v.showFooterSocial === "boolean")
      found.showFooterSocial = v.showFooterSocial;
    if (typeof v.showFooterCopyright === "boolean")
      found.showFooterCopyright = v.showFooterCopyright;
    if (typeof v.instagramUrl === "string" && v.instagramUrl)
      found.instagramUrl = v.instagramUrl;
    if (typeof v.facebookUrl === "string" && v.facebookUrl)
      found.facebookUrl = v.facebookUrl;
    if (typeof v.instagramIcon === "string" && v.instagramIcon)
      found.instagramIcon = v.instagramIcon;
    if (typeof v.facebookIcon === "string" && v.facebookIcon)
      found.facebookIcon = v.facebookIcon;
    for (const child of Object.values(v)) {
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(value);
  return found;
}
export function sharedEmailFooter(value: unknown): EmailBranding {
  const c = content(value);
  return {
    ...extractEmailBranding(c),
    footerConfigured: true,
    footerBackgroundColor: footerBackgroundColor(c),
    footerTextColor: c.footerTextColor || "#ffffff",
    footerTitle: footerTitle(c),
    footerText: c.footerText ?? "",
    footerSocialHeading:
      c.footerSocialHeading ?? defaultGeneratedEmailCopy.footerSocialHeading,
    footerUnsubscribeText:
      c.footerUnsubscribeText ?? defaultGeneratedEmailCopy.unsubscribeIntro,
    footerUnsubscribeLinkText:
      c.footerUnsubscribeLinkText ?? defaultGeneratedEmailCopy.unsubscribeLink,
    footerCopyrightText: c.footerCopyrightText ?? defaultFooterCopyright,
    showPostalAddress: c.showPostalAddress === true,
    showFooterSocial: c.showFooterSocial !== false,
    showFooterCopyright: c.showFooterCopyright !== false,
  };
}
export function segment(value: unknown): Segment {
  const s = (value || {}) as Segment;
  const result: Segment = {};
  for (const key of [
    "openedDays",
    "purchasedDays",
    "excludePurchasedDays",
  ] as const) {
    if (s[key] != null) {
      if (!Number.isInteger(s[key]) || s[key]! < 1 || s[key]! > 3650)
        throw new Error("Audience windows must be 1–3650 days.");
      result[key] = s[key];
    }
  }
  if (s.tag) result.tag = String(s.tag).toLowerCase().slice(0, 100);
  if (s.list) result.list = String(s.list).slice(0, 100);
  return result;
}
export function eligible(
  consent: { status: string; suppressed: boolean } | null | undefined,
) {
  return consent?.status === "SUBSCRIBED" && !consent.suppressed;
}
export function matches(
  profile: {
    tags: string[];
    lists: string[];
    lastOpenedAt: Date | null;
    lastOrderAt: Date | null;
  },
  s: Segment,
  now = new Date(),
) {
  const recent = (d: Date | null, days: number) =>
    !!d && d.getTime() >= now.getTime() - days * DAY && d <= now;
  return (
    (!s.openedDays || recent(profile.lastOpenedAt, s.openedDays)) &&
    (!s.tag || profile.tags.includes(s.tag)) &&
    (!s.list || profile.lists.includes(s.list)) &&
    (!s.purchasedDays || recent(profile.lastOrderAt, s.purchasedDays)) &&
    (!s.excludePurchasedDays ||
      !recent(profile.lastOrderAt, s.excludePurchasedDays))
  );
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function footerTitle(c: Content) {
  const layout = c.layout || c.template;
  return (
    c.footerTitle ??
    (layout === "b2b-wholesale" && !c.footerImage
      ? "Thank you for your business"
      : "")
  );
}
export const defaultFooterCopyright =
  "© {{ year }} {{ organization }} | All rights reserved.";
export const defaultGeneratedEmailCopy = {
  unsubscribeIntro: "No longer want to receive these emails?",
  unsubscribeLink: "Unsubscribe",
  footerSocialHeading: "Follow Us",
  b2bIntro: 'Hi {{ first_name|default:"Friend" }}!',
  welcomeCouponLabel: "Discount Code:",
  welcomeCouponLabelAbove: "10% OFF Your Entire Order:",
  welcomeCouponTerms: "One use. Cannot combine with other discounts.",
  couponExpiry: "Expires {{ coupon_expires }} Pacific time.",
  couponExpiryFallback: "your personal expiration date",
  cartCouponLabel: "Use Discount Code:",
  cartCouponTerms:
    "10% off your order. One use. Cannot combine with other discounts.",
  genericCouponLabel: "Your 10% discount code:",
  welcomeHeroGreeting: '{{ first_name|default:"Aloha" }},',
  welcomeFirstHeroGreeting: 'Aloha {{ first_name|default:"Friend" }},',
  welcomeHeroAbove: "Thank you\nfor subscribing\nto our newsletter!",
  welcomeHeroBelow: "Save 10% off\nyour entire order!",
  socialFollow: "FOLLOW US ON",
  instagramHeading: "INSTAGRAM",
  instagramHandle: "@coralsanonymous",
  instagramText: "DAILY CORAL POSTS, SALES, AND MORE!",
  facebookHeading: "FACEBOOK",
  facebookHandle: "@coralsanonymousshop",
  facebookText: "CORAL SALES, PROMO CODES AND MORE!",
  instagramUrl: "https://www.instagram.com/coralsanonymous/",
  facebookUrl: "https://www.facebook.com/coralsanonymousshop/",
} as const;
export function footerBackgroundColor(c: Content) {
  if (c.footerBackgroundColor) return c.footerBackgroundColor;
  const layout = c.layout || c.template || "standard";
  if (layout === "campaign-sale") return "#050505";
  if (layout === "welcome" || layout === "welcome-social") return "#f7f7f7";
  if (layout === "cart-recovery") return "#8bd8e2";
  if (layout === "b2b-wholesale") return "#244b7b";
  return "#ffffff";
}
export function footerCopyright(
  c: Content,
  organizationName: string,
  now = new Date(),
) {
  if (c.showFooterCopyright === false) return "";
  return (c.footerCopyrightText ?? defaultFooterCopyright)
    .replaceAll("{{ year }}", String(now.getFullYear()))
    .replaceAll("{{ organization }}", organizationName);
}
function universalFooterHtml(
  c: Content,
  unsubscribe: string,
  address: string,
  organizationName: string,
) {
  const e = escapeHtml;
  const textColor = c.footerTextColor || "#ffffff";
  const social =
    c.showFooterSocial !== false && (c.facebookUrl || c.instagramUrl)
      ? ((c.footerSocialHeading ??
          defaultGeneratedEmailCopy.footerSocialHeading)
          ? '<strong style="display:block;margin:18px 0 12px;font-size:18px">' +
            e(
              c.footerSocialHeading ??
                defaultGeneratedEmailCopy.footerSocialHeading,
            ) +
            "</strong>"
          : "") +
        '<p style="margin:0 0 14px;font-size:25px">' +
        (c.facebookUrl
          ? '<a href="' + e(c.facebookUrl) + '" aria-label="Facebook" style="display:inline-block;color:' + e(textColor) + ';text-decoration:none;margin:0 12px;vertical-align:middle">' +
            (c.facebookIcon
              ? '<img src="' + e(c.facebookIcon) + '" alt="" width="32" style="display:block;width:32px;max-width:32px;height:auto;border:0">'
              : "f") +
            "</a>"
          : "") +
        (c.instagramUrl
          ? '<a href="' + e(c.instagramUrl) + '" aria-label="Instagram" style="display:inline-block;color:' + e(textColor) + ';text-decoration:none;margin:0 12px;vertical-align:middle">' +
            (c.instagramIcon
              ? '<img src="' + e(c.instagramIcon) + '" alt="" width="32" style="display:block;width:32px;max-width:32px;height:auto;border:0">'
              : "◎") +
            "</a>"
          : "") +
        "</p>"
      : "";
  return (
    '<tr><td class="reef-email-footer" style="padding:24px;background:' +
    e(footerBackgroundColor(c)) +
    ";color:" +
    e(textColor) +
    ';text-align:center;font-size:12px;line-height:1.6">' +
    (c.footerImage
      ? '<img src="' + e(c.footerImage) + '" alt="" width="' + Math.round(560 * (c.footerScale || 1)) + '" style="display:block;width:' + Math.round(560 * (c.footerScale || 1)) + 'px;max-width:100%;height:auto;margin:0 auto 14px">'
      : "") +
    (footerTitle(c)
      ? '<h2 style="margin:0 0 14px;color:' + e(textColor) + ';font-size:18px">' + e(footerTitle(c)) + "</h2>"
      : "") +
    (c.footerText
      ? '<p style="margin:12px 0">' + e(c.footerText).replace(/\n/g, "<br>") + "</p>"
      : "") +
    social +
    "<p>" +
    e(organizationName) +
    (address ? "<br>" + e(address) : "") +
    "</p>" +
    (footerCopyright(c, organizationName)
      ? '<p style="margin:12px 0">' + e(footerCopyright(c, organizationName)) + "</p>"
      : "") +
    "<p>" +
    e(c.footerUnsubscribeText ?? defaultGeneratedEmailCopy.unsubscribeIntro) +
    ' <a href="' + e(unsubscribe) + '" style="color:' + e(textColor) + ';text-decoration:underline">' +
    e(c.footerUnsubscribeLinkText || defaultGeneratedEmailCopy.unsubscribeLink) +
    "</a></p></td></tr>"
  );
}
const emailHead =
  '<head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%!important}table{border-spacing:0}img{max-width:100%!important;height:auto}td{overflow-wrap:anywhere;word-break:normal}.reef-copy *{max-width:100%;box-sizing:border-box;overflow-wrap:anywhere}.reef-copy a{word-break:break-word}@media only screen and (max-width:480px){.reef-outer{padding:8px!important}.reef-copy{padding:24px 20px!important;font-size:15px!important}.reef-copy div,.reef-copy p,.reef-copy li{font-size:15px!important;line-height:1.6!important}.reef-copy h1{font-size:25px!important;line-height:1.2!important;margin-bottom:24px!important}.reef-copy.reef-cart-hero{height:450px!important;padding:52px 16px 40px!important}.reef-cart-copy h1{font-size:28px!important;line-height:1.35!important;margin-bottom:8px!important}.reef-cart-copy .reef-cart-message,.reef-cart-copy .reef-cart-message p,.reef-cart-copy .reef-cart-message div{font-size:28px!important;line-height:1.35!important}.reef-logo{padding:12px 10px!important}.reef-campaign-nav td{display:block!important;width:100%!important;padding:5px 10px!important}.reef-campaign-product{display:block!important;width:100%!important;box-sizing:border-box!important}.reef-cart-product{display:block!important;width:100%!important;box-sizing:border-box!important}.reef-product-card img{max-width:100%!important;height:auto!important}}</style></head>';

function campaignSaleHtml(
  c: Content,
  unsubscribe: string,
  address: string,
  organizationName: string,
  profileName?: string,
) {
  const layout = c.campaignLayout!;
  const style = layout.style;
  const e = escapeHtml;
  const font =
    style.fontFamily === "Trebuchet MS"
      ? "'Trebuchet MS',Arial,sans-serif"
      : `${style.fontFamily},Arial,sans-serif`;
  const nav = layout.navigation.length
    ? '<table role="presentation" class="reef-campaign-nav" width="100%" style="table-layout:fixed"><tr>' +
      layout.navigation
        .map(
          (item) =>
            '<td align="center" style="padding:10px 6px"><a href="' +
            e(item.url) +
            '" style="color:' +
            e(style.textColor) +
            ';font-weight:bold;text-decoration:none;font-size:15px">' +
            e(item.label) +
            "</a></td>",
        )
        .join("") +
      "</tr></table>"
    : "";
  const hero = c.hero
    ? '<tr><td><a href="' +
      e(layout.heroLink || c.url) +
      '"><img src="' +
      e(c.hero) +
      '" alt="' +
      e(personalize(c.heading, profileName)) +
      '" width="600" style="display:block;width:100%;max-width:600px;height:auto"></a></td></tr>'
    : "";
  const usesDynamicFlowContent = c.template !== "campaign-sale";
  const dynamicProducts: CampaignEmailSection[] =
    usesDynamicFlowContent && c.products?.length
      ? [
          {
            id: "dynamic-flow-products",
            type: "products",
            backgroundColor: style.contentBackground,
            products: c.products.map((product, index) => ({
              id: `dynamic-product-${index}`,
              title: product.title,
              url: product.url,
              image: product.image,
              salePrice: product.price,
              compareAtPrice: product.compareAtPrice,
              showCompareAtPrice: true,
              button: c.button,
            })),
          },
        ]
      : [];
  const sections = [...dynamicProducts, ...layout.sections]
    .map((section) => {
      if (section.type === "banner")
        return (
          '<tr><td style="padding:10px;background:' +
          e(style.contentBackground) +
          ';text-align:center"><a href="' +
          e(section.url) +
          '" style="display:block;box-sizing:border-box;background:' +
          e(section.backgroundColor || style.contentBackground) +
          ";color:" +
          e(section.textColor || style.textColor) +
          ";border:" +
          (section.borderWidth || 0) +
          "px solid " +
          e(section.borderColor || section.backgroundColor || style.contentBackground) +
          ';padding:17px 14px;font-size:24px;line-height:1.15;font-weight:bold;text-decoration:none">' +
          e(section.text) +
          (section.accent
            ? ' <span style="color:' +
              e(section.accentColor || section.textColor || style.textColor) +
              (section.accentPill
                ? ";background:#ffffff;border-radius:5px;padding:2px 6px"
                : "") +
              ';white-space:nowrap">' +
              e(section.accent) +
              "</span>"
            : "") +
          "</a></td></tr>"
        );
      if (section.type === "cta")
        return (
          '<tr><td style="padding:' +
          style.sectionPadding +
          'px;background:' +
          e(style.contentBackground) +
          ';text-align:center"><a href="' +
          e(section.url) +
          '" style="display:block;background:' +
          e(section.backgroundColor || style.buttonBackground) +
          ";color:" +
          e(section.textColor || style.buttonTextColor) +
          ";border-radius:" +
          style.buttonRadius +
          'px;padding:9px 18px;font-size:25px;line-height:1.1;font-weight:bold;text-decoration:none">' +
          e(section.label) +
          "</a></td></tr>"
        );
      return '<tr><td style="padding:' + style.sectionPadding + 'px;background:' + e(section.backgroundColor || style.contentBackground) + '"><table role="presentation" width="100%" style="table-layout:fixed"><tbody>' + productGridHtml(section.products, style, "reef-campaign-product") + "</tbody></table></td></tr>";
    })
    .join("");
  const dynamicExpiry = c.couponExpiresAt
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "America/Los_Angeles",
      }).format(new Date(c.couponExpiresAt)) + " Pacific time"
    : c.couponExpiryFallbackText ||
      defaultGeneratedEmailCopy.couponExpiryFallback;
  const dynamicCopy =
    c.bodyHtml !== undefined
      ? personalize(
          c.bodyHtml.replaceAll("{{ coupon_expires }}", dynamicExpiry),
          profileName,
          true,
        )
      : e(
          personalize(
            c.body.replaceAll("{{ coupon_expires }}", dynamicExpiry),
            profileName,
          ),
        ).replace(/\n/g, "<br>");
  const dynamicMessage = usesDynamicFlowContent
    ? '<tr><td style="padding:28px ' +
      style.sectionPadding +
      'px;text-align:center;background:' +
      e(style.contentBackground) +
      ';color:' +
      e(style.textColor) +
      '"><h1 style="margin:0 0 18px;font-size:28px;line-height:1.2">' +
      e(personalize(c.heading, profileName)) +
      '</h1><div style="font-size:16px;line-height:1.6">' +
      dynamicCopy +
      "</div>" +
      (c.couponCode
        ? '<div style="margin:22px 0 0"><span style="display:inline-block;border:2px dashed ' +
          e(style.salePriceColor) +
          ';border-radius:8px;padding:10px 16px;font-size:21px;font-weight:bold">' +
          e(c.couponCode) +
          "</span></div>"
        : "") +
      '<p style="margin:24px 0 0"><a href="' +
      e(c.url) +
      '" style="display:inline-block;background:' +
      e(style.buttonBackground) +
      ";color:" +
      e(style.buttonTextColor) +
      ";border-radius:" +
      style.buttonRadius +
      'px;padding:12px 20px;font-weight:bold;text-decoration:none">' +
      e(c.button) +
      "</a></p></td></tr>"
    : "";
  return (
    "<!doctype html><html>" +
    emailHead +
    '<body style="margin:0;background:' + e(style.emailBackground) + ";font-family:" + font + ";color:" + e(style.textColor) + '"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="100%" style="width:100%;max-width:600px;table-layout:fixed;background:' + e(style.contentBackground) + '"><tr><td style="display:none;max-height:0;overflow:hidden">' + e(personalize(c.preview || "", profileName)) + "</td></tr>" +
    '<tr><td class="reef-logo" align="center" style="padding:16px 26px 8px">' +
    (c.logo
      ? '<img src="' + e(c.logo) + '" alt="' + e(organizationName) + '" width="' + Math.round(360 * (c.logoScale || 1)) + '" style="display:block;width:' + Math.round(360 * (c.logoScale || 1)) + 'px;max-width:100%;height:auto;margin:auto">'
      : '<strong style="font-size:27px;font-style:italic">' + e(organizationName.toUpperCase()) + "</strong>") +
    "</td></tr><tr><td style=\"padding:0 20px 8px\">" + nav + "</td></tr>" + hero + dynamicMessage + sections +
    universalFooterHtml(c, unsubscribe, address, organizationName) +
    "</table></td></tr></table></body></html>"
  );
}

export function render(
  c: Content,
  unsubscribe: string,
  address: string,
  profileName?: string,
  organizationName = "Corals Anonymous",
  branding?: EmailBranding,
) {
  c = content(withBranding(content(c), branding));
  address = c.showPostalAddress ? address : "";
  const e = escapeHtml;
  const layout = c.layout || c.template || "standard";
  if (layout === "campaign-sale" && c.campaignLayout)
    return campaignSaleHtml(
      c,
      unsubscribe,
      address,
      organizationName,
      profileName,
    );
  if (layout === "welcome" || layout === "welcome-social") {
    const displayExpiry = c.couponExpiresAt
      ? new Intl.DateTimeFormat("en-US", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "America/Los_Angeles",
        }).format(new Date(c.couponExpiresAt)) + " Pacific time"
      : c.couponExpiryFallbackText ||
        defaultGeneratedEmailCopy.couponExpiryFallback;
    c = {
      ...c,
      body: c.body.replaceAll("{{ coupon_expires }}", displayExpiry),
      bodyHtml: c.bodyHtml?.replaceAll("{{ coupon_expires }}", displayExpiry),
    };
    const social = layout === "welcome-social";
    const illustratedWelcome =
      layout === "welcome" &&
      c.offerAboveBody === true &&
      !c.hero &&
      c.showWelcomeIllustration !== false;
    const heroGreeting = personalize(
      c.welcomeHeroGreeting ??
        (c.offerAboveBody
          ? defaultGeneratedEmailCopy.welcomeFirstHeroGreeting
          : defaultGeneratedEmailCopy.welcomeHeroGreeting),
      profileName,
    );
    const heroText =
      c.welcomeHeroText ??
      (c.offerAboveBody
        ? defaultGeneratedEmailCopy.welcomeHeroAbove
        : defaultGeneratedEmailCopy.welcomeHeroBelow);
    const instagram = c.instagramUrl || defaultGeneratedEmailCopy.instagramUrl;
    const facebook = c.facebookUrl || defaultGeneratedEmailCopy.facebookUrl;
    const body =
      c.bodyHtml !== undefined
        ? personalize(c.bodyHtml, profileName, true)
        : c.offerAboveBody && c.body === firstWelcomeBody
          ? personalize(firstWelcomeBodyHtml, profileName, true)
        : e(personalize(c.body, profileName)).replace(/\n/g, "<br>");
    const expiry = c.couponExpiresAt
      ? '<p style="font-size:12px;color:#555">' +
        e(
          (c.couponExpiryText ?? defaultGeneratedEmailCopy.couponExpiry)
            .replace("{{ coupon_expires }}", displayExpiry),
        ) +
        (c.couponTerms === ""
          ? ""
          : " " +
            e(c.couponTerms || defaultGeneratedEmailCopy.welcomeCouponTerms)) +
        "</p>"
      : "";
    const offer =
      c.couponCode && !social
        ? '<div style="text-align:center;padding:' + (illustratedWelcome ? '8px 0 25px' : '16px 0 28px') + '"><h2 style="font-size:23px;margin:0 0 ' + (illustratedWelcome ? '12px' : '18px') + '">' +
          e(
            c.couponLabel ??
              (c.offerAboveBody
                ? defaultGeneratedEmailCopy.welcomeCouponLabelAbove
                : defaultGeneratedEmailCopy.welcomeCouponLabel),
          ) +
          '</h2><span style="display:inline-block;border:' + (illustratedWelcome ? '1px' : '2px') + ' solid #e6e6e6;border-radius:20px;padding:' + (illustratedWelcome ? '5px 10px' : '8px 16px') + ';font-size:' + (illustratedWelcome ? '22px' : '23px') + ';font-weight:bold;overflow-wrap:anywhere">' +
          e(c.couponCode) +
          "</span>" +
          (illustratedWelcome && c.couponTerms === undefined && c.couponExpiryText === undefined ? '' : expiry) +
          "</div>"
        : "";
    const hero = c.hero
      ? '<img src="' +
        e(c.hero) +
        '" alt="' +
        e(personalize(c.heading, profileName)) +
        '" width="500" style="display:block;width:100%;max-width:500px;height:auto;margin:auto">'
      : illustratedWelcome
        ? '<table role="presentation" width="100%" style="width:100%;max-width:500px;table-layout:fixed;margin:0 auto"><tr><td class="reef-welcome-illustrated" height="500" background="https://reef-ops-dashboard-production.up.railway.app/welcome-hero-crisp.png" style="height:500px;box-sizing:border-box;vertical-align:top;padding:107px 14px 0 182px;text-align:left;background-color:#85d9e2;background-image:url(https://reef-ops-dashboard-production.up.railway.app/welcome-hero-crisp.png);background-size:100% 100%;background-position:center">' +
          '<p class="reef-welcome-greeting" style="font-family:Bahnschrift Condensed,Impact,Arial Narrow,Arial,sans-serif;font-size:29px;line-height:1.1;font-weight:700;color:#101010;margin:0 0 5px;white-space:nowrap">' +
          e(heroGreeting) +
          '</p><table role="presentation" width="100%" style="border-collapse:collapse"><tr><td class="reef-welcome-heart-cell" width="52" valign="top" style="padding:34px 5px 0 0"><span class="reef-welcome-heart" style="display:inline-block;width:38px;height:38px;border-radius:50%;background:#d86670;color:white;text-align:center;font-family:Arial,sans-serif;font-size:29px;line-height:38px">♥</span></td><td valign="top"><p class="reef-welcome-message" style="font-family:Bahnschrift Condensed,Impact,Arial Narrow,Arial,sans-serif;font-size:28px;line-height:1.2;font-weight:700;color:#101010;margin:0">' +
          e(heroText).replace(/\n/g, "<br>") +
          "</p></td></tr></table></td></tr></table>"
      : !social
        ? '<div style="background:#8bd8e2;padding:44px 22px;text-align:center;border:1px solid #459ca4"><p style="font-size:25px;margin:0;color:#172e32;font-weight:bold">' +
          e(heroGreeting) +
          '</p><p style="font-size:29px;line-height:1.25;font-weight:bold;margin:18px 0">' +
          e(heroText).replace(/\n/g, "<br>") +
          "</p></div>"
        : "";
    const socialCard = (
      url: string,
      label: string,
      handle: string,
      copy: string,
      color: string,
    ) =>
      '<td width="50%" valign="top" style="padding:8px"><a href="' +
      e(url) +
      '" style="display:block;background:' +
      color +
      ';padding:28px 12px;color:white;text-decoration:none;text-align:center"><span style="font-size:12px;font-weight:bold">' +
      e(c.socialFollowText ?? defaultGeneratedEmailCopy.socialFollow) +
      '</span><h2 style="font-size:23px;margin:12px 0">' +
      e(label) +
      '</h2><span style="font-size:12px">' +
      e(handle) +
      '</span><p style="font-weight:bold;font-size:16px;line-height:1.4;margin-top:28px">' +
      e(copy) +
      "</p></a></td>";
    return (
      "<!doctype html><html>" +
      (illustratedWelcome
        ? emailHead.replace('</style></head>', '@media only screen and (max-width:480px){.reef-welcome-hero-wrap{padding:0 8px!important}.reef-welcome-illustrated{height:360px!important;padding:75px 8px 0 33%!important;background-size:100% 100%!important}.reef-welcome-greeting{font-size:23px!important;line-height:1.1!important;white-space:normal!important}.reef-welcome-message{font-size:21px!important;line-height:1.18!important}.reef-welcome-heart-cell{width:34px!important;padding:24px 4px 0 0!important}.reef-welcome-heart{width:28px!important;height:28px!important;line-height:28px!important;font-size:21px!important}}@media only screen and (max-width:360px){.reef-welcome-illustrated{height:310px!important;padding-top:65px!important}.reef-welcome-greeting{font-size:20px!important}.reef-welcome-message{font-size:18px!important}}</style></head>')
        : emailHead) +
      '<body style="margin:0;background:#f7f7f7;font-family:Arial,sans-serif;color:#080808"><table role="presentation" width="100%"><tr><td class="reef-outer" align="center" style="padding:' +
      (illustratedWelcome ? "0" : "16px") +
      '"><table role="presentation" width="100%" style="max-width:600px;table-layout:fixed;background:white"><tr><td style="display:none;font-size:1px;max-height:0;overflow:hidden">' +
      e(personalize(c.preview || "", profileName)) +
      "</td></tr>" +
      (c.logo && !illustratedWelcome
        ? '<tr><td class="reef-logo" align="center" style="padding:20px"><img src="' +
          e(c.logo) +
          '" alt="' +
          e(organizationName) +
          '" width="' +
          Math.round(260 * (c.logoScale || 1)) +
          '" style="max-width:100%;height:auto"></td></tr>'
        : "") +
      '<tr><td class="reef-welcome-hero-wrap" style="padding:' +
      (illustratedWelcome ? "0 50px" : "8px 30px 0") +
      '">' +
      hero +
      '</td></tr><tr><td class="reef-copy" style="padding:16px 30px 24px;font-size:16px;line-height:1.4"><h1 style="text-align:center;font-size:28px;line-height:1.2;margin:0 0 ' + (illustratedWelcome ? '8px' : '22px') + '">' +
      e(personalize(c.heading, profileName)) +
      "</h1>" +
      (c.offerAboveBody ? offer : "") +
      '<div style="' +
      (c.offerAboveBody
        ? "border-top:1px solid #ddd;padding-top:30px;text-align:left"
        : "text-align:center") +
      '">' +
      body +
      "</div>" +
      (!c.offerAboveBody ? offer : "") +
      (social
        ? '<table role="presentation" width="100%" style="table-layout:fixed;margin-top:24px"><tr>' +
          socialCard(
            instagram,
            c.instagramHeading ?? defaultGeneratedEmailCopy.instagramHeading,
            c.instagramHandle ?? defaultGeneratedEmailCopy.instagramHandle,
            c.instagramText ?? defaultGeneratedEmailCopy.instagramText,
            "#c95379",
          ) +
          socialCard(
            facebook,
            c.facebookHeading ?? defaultGeneratedEmailCopy.facebookHeading,
            c.facebookHandle ?? defaultGeneratedEmailCopy.facebookHandle,
            c.facebookText ?? defaultGeneratedEmailCopy.facebookText,
            "#606aff",
          ) +
          "</tr></table>"
        : "") +
      cartProductHtml(c) +
      '<p style="margin:26px 0 0;text-align:center"><a href="' +
      e(c.url) +
      '" style="display:block;border-radius:4px;background:#e69a49;padding:12px 16px;color:white;font-size:17px;font-weight:bold;text-decoration:none">' +
      e(c.button) +
      "</a></p></td></tr>" +
      universalFooterHtml(
        { ...c, instagramUrl: instagram, facebookUrl: facebook },
        unsubscribe,
        address,
        organizationName,
      ) +
      "</table></td></tr></table></body></html>"
    );
  }
  if (c.couponCode && layout !== "cart-recovery") {
    const line =
      (c.couponLabel ?? defaultGeneratedEmailCopy.genericCouponLabel) +
      " " +
      c.couponCode;
    c = {
      ...c,
      body: c.body + "\n\n" + line,
      ...(c.bodyHtml !== undefined
        ? { bodyHtml: c.bodyHtml + "<p>" + e(line) + "</p>" }
        : {}),
    };
  }
  if (layout === "cart-recovery") {
    const copy =
      c.bodyHtml !== undefined
        ? personalize(c.bodyHtml, profileName, true)
        : e(personalize(c.body, profileName)).replace(/\n/g, "<br>");
    const oceanImage =
      c.hero ||
      (c.showCartOceanTexture === false
        ? undefined
        : "https://reef-ops-dashboard-production.up.railway.app/cart-ocean-texture.jpg");
    const bandColor = c.cartHeroBandColor || "#95dce5";
    const textSize = c.cartHeroTextSize || 32;
    const buttonWidth = c.cartHeroButtonWidth || 234;
    const outlinedText =
      "color:#ffffff;text-shadow:-1px -1px 0 #17282c,1px -1px 0 #17282c,-1px 1px 0 #17282c,1px 1px 0 #17282c,2px 3px 1px #17282c;-webkit-text-stroke:1px #17282c;";
    const logo = c.logo
      ? '<img src="' +
        e(c.logo) +
        '" alt="' +
        e(organizationName) +
        '" width="' +
        Math.round(260 * (c.logoScale || 1)) +
        '" style="max-width:100%;height:auto">'
      : '<strong style="font-size:24px;font-style:italic;color:#102d33">' +
        e(organizationName.toUpperCase()) +
        "</strong>";
    return (
      "<!doctype html><html>" +
      emailHead +
      '<body style="background:#ffffff;margin:0;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" class="reef-outer" style="padding:0"><table role="presentation" width="100%" style="max-width:600px;table-layout:fixed;background:#ffffff"><tr><td class="reef-logo" style="background:#ffffff;padding:24px;text-align:center">' +
      '<span style="display:none;max-height:0;overflow:hidden;mso-hide:all">' +
      e(personalize(c.preview || "", profileName)) +
      "</span>" +
      logo +
      '</td></tr><tr><td align="center" style="padding:14px 0 0;background:' +
      e(bandColor) +
      ';background-image:linear-gradient(to bottom,#ffffff 0%,#ffffff 58%,' +
      e(bandColor) + ' 58%,' + e(bandColor) +
      ' 100%)"><table role="presentation" width="400" style="width:100%;max-width:400px;table-layout:fixed"><tr><td class="reef-copy reef-cart-copy reef-cart-hero"' +
      (oceanImage ? ' background="' + e(oceanImage) + '"' : "") +
      ' height="500" style="height:500px;box-sizing:border-box;vertical-align:top;padding:68px 20px 42px;text-align:center;background-color:#79bfca;' +
      (oceanImage
        ? "background-image:url('" + e(oceanImage) +
          "');background-size:cover;background-position:center;"
        : "") +
      '">' +
      '<h1 style="font-family:Georgia,Times New Roman,serif;font-style:italic;font-weight:700;font-size:' +
      textSize + 'px;line-height:1.36;margin:0 0 8px;' + outlinedText + '">' +
      e(personalize(c.heading, profileName)) +
      '</h1><div class="reef-cart-message" style="font-family:Georgia,Times New Roman,serif;font-style:italic;font-weight:700;font-size:' +
      textSize + 'px;line-height:1.36;' + outlinedText + '">' +
      copy +
      "</div>" +
      (c.couponCode
        ? '<p style="font-size:14px;margin-top:30px">' +
          e(c.couponLabel ?? defaultGeneratedEmailCopy.cartCouponLabel) +
          '</p><p style="font-weight:bold;font-size:22px;overflow-wrap:anywhere">' +
          e(c.couponCode) +
          '</p><p style="font-size:12px">' +
          e(c.couponTerms ?? defaultGeneratedEmailCopy.cartCouponTerms) +
          "</p>"
        : "") +
      '</td></tr></table></td></tr><tr><td align="center" style="padding:9px 20px 43px;background:' +
      e(bandColor) +
      ';border-top:1px solid #87c5cf"><a href="' +
      e(c.url) +
      '" style="display:inline-block;max-width:100%;box-sizing:border-box;width:' +
      buttonWidth +
      'px;background:#ffffff;border-radius:28px;padding:13px 12px;color:#000000;font-family:Arial,sans-serif;font-size:14px;line-height:20px;font-weight:bold;text-align:center;text-decoration:none">' +
      e(c.button) +
      '</a></td></tr><tr><td style="padding:8px 28px 24px;background:white;text-align:center">' +
      cartProductHtml(c) +
      "</td></tr>" +
      universalFooterHtml(c, unsubscribe, address, organizationName) +
      "</table></td></tr></table></body></html>"
    );
  }
  if (layout === "b2b-wholesale") {
    const lines = c.body.split(String.fromCharCode(10));
    const greeting = personalize(
      c.introText === undefined
        ? lines[0] || defaultGeneratedEmailCopy.b2bIntro
        : c.introText,
      profileName,
    );
    const plainBody = ("<p>" + e(lines.slice(2).join("\n")) + "</p>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/\n/g, "<br>")
      .replace(/50-80%/g, '<span style="color:#f05a28">50-80%</span>')
      .replace(
        /\bhomepage\b/gi,
        '<a style="color:#1f5f9e" href="' + e(c.url) + '">homepage</a>',
      );
    const bodyHtml =
      c.bodyHtml !== undefined
        ? personalize(c.bodyHtml, profileName, true)
        : plainBody;
    // The rich editor saves paragraphs for each line. Default browser margins
    // make the three wholesale benefits look like unrelated sections in email.
    // Keep explicitly styled paragraphs untouched while tightening plain ones.
    const compactBodyHtml = bodyHtml
      .replace(/<p>\s*(?:<br\s*\/?\s*>|&nbsp;)?\s*<\/p>/gi, "")
      .replace(/<p>/gi, '<p style="margin:0 0 10px;line-height:1.45">')
      .replace(/<ul>/gi, '<ul style="margin:8px 0 12px;padding-left:26px">')
      .replace(/<ol>/gi, '<ol style="margin:8px 0 12px;padding-left:26px">');
    const customBody =
      !!c.bodyHtml?.trim() &&
      (/<h1\b/i.test(c.bodyHtml) ||
        /first_name\s*\|\s*default/i.test(c.bodyHtml));
    const logoScale = Math.min(
      2.5,
      Math.max(
        0.25,
        Number(c.logoScale ?? (c.logoWidth ? c.logoWidth / 260 : 1)) || 1,
      ),
    );
    const logo = c.logo
      ? '<img src="' +
        e(c.logo) +
        '" alt="Corals Anonymous" style="max-width:100%;width:' +
        String(Math.round(260 * logoScale)) +
        'px;height:auto">'
      : '<strong style="font-size:24px;font-style:italic;color:#102d33">' +
        e(organizationName.toUpperCase()) +
        "</strong>";
    return (
      "<!doctype html><html>" +
      emailHead +
      '<body style="margin:0;background:#07143a;font-family:Arial,sans-serif;color:#101820"><table role="presentation" width="100%"><tr><td align="center" class="reef-outer" style="padding:14px"><table role="presentation" width="100%" style="width:100%;max-width:600px;table-layout:fixed;background:white"><tr><td class="reef-logo" style="padding:12px 28px 18px;text-align:center">' +
      '<span style="display:none;max-height:0;overflow:hidden;mso-hide:all">' +
      e(personalize(c.preview || "", profileName)) +
      "</span>" +
      logo +
      '<hr style="border:0;border-top:1px solid #c9c9c9;margin:14px 0 0"></td></tr><tr><td class="reef-copy" style="padding:36px 52px 24px;font-size:13px;line-height:1.55">' +
      (customBody
        ? bodyHtml
        : '<h1 style="text-align:center;font-size:27px;line-height:1.15;margin:0 0 45px">' +
          e(personalize(c.heading, profileName)) +
          "</h1>" +
          (greeting
            ? '<p style="text-align:center;font-weight:bold;font-size:16px">' +
              e(greeting) +
              "</p>"
            : "") +
          '<div style="font-size:13px;line-height:1.45">' +
          compactBodyHtml +
          "</div>") +
      productHtml(c) +
      '</td></tr><tr><td style="padding:0 15px 8px;text-align:center"><a style="display:block;background:#ee984e;color:white;text-decoration:none;padding:13px 18px;font-weight:bold;font-size:16px" href="' +
      e(c.url) +
      '">' +
      e(c.button) +
      "</a></td></tr>" +
      universalFooterHtml(c, unsubscribe, address, organizationName) +
      "</table></td></tr></table></body></html>"
    );
  }
  return (
    "<!doctype html><html>" +
    emailHead +
    '<body style="margin:0;background:#eef5f4;font-family:Arial,sans-serif;color:#123334"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="100%" style="width:100%;max-width:600px;table-layout:fixed;background:white"><tr><td style="padding:28px;text-align:center;background:#083b3b;color:white;font-size:25px;font-weight:bold">' +
    e(organizationName.toUpperCase()) +
    '</td></tr><tr><td style="display:none">' +
    e(personalize(c.preview || "", profileName)) +
    "</td></tr>" +
    (c.hero
      ? '<tr><td><a href="' +
        e(c.url) +
        '"><img src="' +
        e(c.hero) +
        '" alt="' +
        e(personalize(c.heading, profileName)) +
        '" width="600" style="max-width:100%"></a></td></tr>'
      : "") +
    '<tr><td class="reef-copy" style="padding:28px"><h1>' +
    e(personalize(c.heading, profileName)) +
    '</h1><div style="line-height:1.7">' +
    (c.bodyHtml !== undefined
      ? personalize(c.bodyHtml, profileName, true)
      : e(personalize(c.body, profileName)).replace(/\n/g, "<br>")) +
    productHtml(c) +
    '</div><p><a style="display:inline-block;background:#087f78;padding:16px 24px;color:white" href="' +
    e(c.url) +
    '">' +
    e(c.button) +
    "</a></p></td></tr>" +
    universalFooterHtml(c, unsubscribe, address, organizationName) +
    "</table></td></tr></table></body></html>"
  );
}
export const defaultContent: Content = {
  heading: "Discover your next reef favorite",
  body: "Explore the latest arrivals at Corals Anonymous.",
  button: "Shop now",
  url: "https://coralsanonymous.com",
  preview: "Fresh arrivals for your reef.",
};
export const defaultCampaignContent: Content = {
  heading: "Corals Anonymous sale",
  body: "Shop this week's featured corals.",
  button: "Shop now",
  url: "https://coralsanonymous.com/collections/new-arrivals",
  preview: "Fresh deals and new arrivals from Corals Anonymous.",
  template: "campaign-sale",
  showPostalAddress: true,
  campaignLayout: {
    heroLink: "https://coralsanonymous.com/collections/new-arrivals",
    navigation: [
      { label: "🔥 New Corals", url: "https://coralsanonymous.com/collections/new-arrivals" },
      { label: "🏷️ Deal Busters", url: "https://coralsanonymous.com/collections/deal-busters" },
      { label: "✚ Earn Points & Save!", url: "https://coralsanonymous.com/pages/rewards" },
    ],
    sections: [
      {
        id: "sale-products",
        type: "products",
        backgroundColor: "#ffffff",
        feed: campaignProductFeed({ key: "anniversarysalesale" }),
        products: [],
      },
      {
        id: "new-discount-products",
        type: "products",
        backgroundColor: "#ffffff",
        feed: campaignProductFeed({ key: "newnewdiscount" }),
        products: [],
      },
      {
        id: "shop-cta",
        type: "cta",
        label: "SHOP NOW!",
        url: "https://coralsanonymous.com/collections/new-arrivals",
        backgroundColor: "#3c8429",
        textColor: "#ffffff",
      },
      {
        id: "newest-products",
        type: "products",
        backgroundColor: "#ffffff",
        feed: campaignProductFeed({ key: "newnew1" }),
        products: [],
      },
      {
        id: "shop-app-banner",
        type: "banner",
        text: "TAP. SHOP. DONE.  |  NOW ON THE SHOP APP!",
        accent: "shop",
        url: "https://coralsanonymous.com/collections/new-arrivals",
        backgroundColor: "#ffffff",
        textColor: "#111111",
        accentColor: "#5439ee",
        borderColor: "#5439ee",
        borderWidth: 4,
      },
      {
        id: "shop-pay-banner",
        type: "banner",
        text: "Buy now, pay later with Shop",
        accent: "Pay",
        url: "https://coralsanonymous.com/collections/new-arrivals",
        backgroundColor: "#5439ee",
        textColor: "#ffffff",
        accentColor: "#5439ee",
        accentPill: true,
        borderColor: "#5439ee",
        borderWidth: 0,
      },
    ],
    style: {
      fontFamily: "Arial",
      emailBackground: "#fff7f5",
      contentBackground: "#ffffff",
      textColor: "#080808",
      salePriceColor: "#e84218",
      buttonBackground: "#79e93c",
      buttonTextColor: "#000000",
      productAlignment: "center",
      productGap: 18,
      sectionPadding: 18,
      productImageWidth: 140,
      buttonRadius: 5,
      titleSize: 18,
      priceSize: 21,
    },
  },
};
export const flowDefaults = [
  {
    key: "delivery-upsell",
    name: "24 Hour Notice | Upsell",
    trigger: "DELIVERY_SCHEDULED",
    description:
      "Send one add-on reminder two calendar days before the Shopify delivery-date tag. Triom handles order merging and refunds.",
    delays: [0],
  },
  {
    key: "abandoned-cart",
    name: "Abandoned Cart",
    trigger: "CHECKOUT_STARTED",
    description:
      "Email sequence with purchase checks before every message; SMS branch at 30 minutes when eligible. Review email delays and copy.",
    delays: [180, 1440],
  },
  {
    key: "b2b-welcome",
    name: "B2B Welcoming Email",
    trigger: "B2B_ENTERED",
    description:
      "Once per profile on entering Shopify tag b2b. Existing imports do not enroll.",
    delays: [0],
  },
  {
    key: "low-stock",
    name: "Low Stock Alert: T5",
    trigger: "LOW_STOCK",
    description:
      "Staff email and text when a tracked variant in the selected collection drops below the threshold; re-arms after observed recovery.",
    delays: [0],
  },
  {
    key: "welcome",
    name: "Welcome Series 08.2025",
    trigger: "EMAIL_SUBSCRIBED",
    description:
      "Single opt-in welcome, reminders on days 3 and 10, a 14-day personal offer, and a social email on day 15. No re-entry.",
    delays: [0, 4320, 14400, 21600],
  },
] as const;
