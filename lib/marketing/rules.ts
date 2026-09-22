import { FilterXSS } from "xss";
import { decode } from "he";
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
export type Content = {
  heading: string;
  body: string;
  bodyHtml?: string;
  button: string;
  url: string;
  hero?: string;
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
  footerTitle?: string;
  showPostalAddress?: boolean;
  footerText?: string;
  footerUnsubscribeText?: string;
  showFooterCopyright?: boolean;
  footerCopyrightText?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  instagramIcon?: string;
  facebookIcon?: string;
  /** @deprecated Older saved flows may still contain these pixel values. */ logoWidth?: number;
  logoHeight?: number;
  footerWidth?: number;
  footerHeight?: number;
  products?: { title: string; url: string; image?: string; price?: string }[];
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
  footerImage?: string;
  footerScale?: number;
  instagramUrl?: string;
  facebookUrl?: string;
  instagramIcon?: string;
  facebookIcon?: string;
};
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
      c.couponExpiresAt || "your personal expiration date",
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
function cartProductHtml(c: Content) {
  const products = c.products || [];
  if (!products.length) return "";
  const rows: string[] = [];
  for (let i = 0; i < products.length; i += 2) {
    const cells = products
      .slice(i, i + 2)
      .map(
        (p) =>
          '<td valign="top" width="50%" style="width:50%;padding:12px 8px 18px;text-align:center">' +
          '<a href="' +
          escapeHtml(p.url) +
          '" style="color:#122f35;text-decoration:none">' +
          (p.image
            ? '<img src="' +
              escapeHtml(p.image) +
              '" width="240" alt="' +
              escapeHtml(p.title) +
              '" style="display:block;width:100%;max-width:240px;height:auto;margin:0 auto 9px;background:#f1f4f4">'
            : '<div style="width:100%;height:150px;background:#f1f4f4;margin:0 auto 9px;color:#7b8789;font-size:12px;line-height:150px">Product image</div>') +
          '<strong style="display:block;font-family:Georgia,serif;font-size:16px;line-height:1.25;text-decoration:underline">' +
          escapeHtml(p.title) +
          "</strong>" +
          (p.price
            ? '<span style="display:block;margin-top:7px;color:#0b9b91;font-size:14px">' +
              escapeHtml(p.price) +
              "</span>"
            : "") +
          "</a></td>",
      );
    if (cells.length === 1)
      cells.push(
        '<td width="50%" style="width:50%;padding:12px 8px 18px">&nbsp;</td>',
      );
    rows.push("<tr>" + cells.join("") + "</tr>");
  }
  return (
    '<table role="presentation" class="reef-cart-products" width="100%" style="width:100%;border-collapse:collapse;table-layout:fixed;border-top:1px solid #71cbd2;margin-top:18px"><tbody>' +
    rows.join("") +
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
  const rawLayout = c.campaignLayout;
  const campaignLayout: CampaignEmailLayout | undefined = rawLayout
    ? {
        heroLink: rawLayout.heroLink
          ? safeUrl(rawLayout.heroLink).slice(0, 500)
          : undefined,
        navigation: (rawLayout.navigation || []).slice(0, 5).map((item) => ({
          label: String(item.label || "Link").slice(0, 80),
          url: safeUrl(item.url).slice(0, 500),
        })),
        sections: (rawLayout.sections || []).slice(0, 20).map((section, index) => {
          if (section.type === "banner")
            return {
              id: String(section.id || `banner-${index}`).slice(0, 100),
              type: "banner" as const,
              text: String(section.text || "Promotional banner").slice(0, 200),
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
              label: String(section.label || "Shop now").slice(0, 100),
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
              title: String(product.title || "Product name").slice(0, 200),
              url: safeUrl(product.url).slice(0, 500),
              image: product.image ? safeUrl(product.image).slice(0, 500) : undefined,
              salePrice: String(product.salePrice || "").slice(0, 80),
              compareAtPrice: String(product.compareAtPrice || "").slice(0, 80),
              button: String(product.button || "Shop now").slice(0, 80),
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
    heading: c.heading.slice(0, 200),
    body: c.body,
    bodyHtml:
      c.bodyHtml !== undefined && c.bodyHtml !== null
        ? sanitizeEmailHtml(c.bodyHtml)
        : undefined,
    button: String(c.button || "Shop now").slice(0, 80),
    url: safeUrl(c.url),
    hero: c.hero ? imageSource(c.hero) : undefined,
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
    footerTitle:
      c.footerTitle === undefined
        ? undefined
        : String(c.footerTitle).slice(0, 200),
    footerText:
      c.footerText === undefined
        ? undefined
        : String(c.footerText).slice(0, 2000),
    footerUnsubscribeText:
      c.footerUnsubscribeText === undefined
        ? undefined
        : String(c.footerUnsubscribeText).slice(0, 300),
    showFooterCopyright: c.showFooterCopyright !== false,
    footerCopyrightText:
      c.footerCopyrightText === undefined
        ? undefined
        : String(c.footerCopyrightText).slice(0, 300),
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
    })),
    campaignLayout,
  };
}
export function withBranding(c: Content, branding?: EmailBranding): Content {
  if (!branding) return c;
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
function socialHtml(c: Content) {
  if (!c.instagramUrl && !c.facebookUrl) return "";
  return (
    '<div style="margin:24px 0 14px;text-align:center">' +
    '<strong style="display:block;margin-bottom:12px;color:#122f35;font-size:18px">Follow Us</strong>' +
    (c.instagramUrl
      ? '<a href="' +
        escapeHtml(c.instagramUrl) +
        '" style="display:inline-block;margin:0 9px;color:#122f35;font-size:24px;font-weight:bold;text-decoration:none;vertical-align:middle" aria-label="Instagram">' +
        (c.instagramIcon
          ? '<img src="' + escapeHtml(c.instagramIcon) + '" alt="" width="32" style="display:block;width:32px;max-width:32px;height:auto;border:0">'
          : "◎") +
        "</a>"
      : "") +
    (c.facebookUrl
      ? '<a href="' +
        escapeHtml(c.facebookUrl) +
        '" style="display:inline-block;margin:0 9px;color:#122f35;font-family:Arial,sans-serif;font-size:24px;font-weight:bold;text-decoration:none;vertical-align:middle" aria-label="Facebook">' +
        (c.facebookIcon
          ? '<img src="' + escapeHtml(c.facebookIcon) + '" alt="" width="32" style="display:block;width:32px;max-width:32px;height:auto;border:0">'
          : "f") +
        "</a>"
      : "") +
    "</div>"
  );
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
const emailHead =
  '<head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%!important}table{border-spacing:0}img{max-width:100%!important;height:auto}td{overflow-wrap:anywhere;word-break:normal}.reef-copy *{max-width:100%;box-sizing:border-box;overflow-wrap:anywhere}.reef-copy a{word-break:break-word}@media only screen and (max-width:480px){.reef-outer{padding:8px!important}.reef-copy{padding:24px 20px!important;font-size:15px!important}.reef-copy div,.reef-copy p,.reef-copy li{font-size:15px!important;line-height:1.6!important}.reef-copy h1{font-size:25px!important;line-height:1.2!important;margin-bottom:24px!important}.reef-logo{padding:12px 10px!important}.reef-campaign-nav td{display:block!important;width:100%!important;padding:5px 10px!important}.reef-campaign-product{display:block!important;width:100%!important;box-sizing:border-box!important}.reef-campaign-product img{max-width:100%!important;height:auto!important}}</style></head>';

function campaignSaleHtml(
  c: Content,
  unsubscribe: string,
  address: string,
  organizationName: string,
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
      e(c.heading) +
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
              showCompareAtPrice: false,
              button: "Shop now",
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
      const rows: string[] = [];
      for (let index = 0; index < section.products.length; index += 2) {
        const cells = section.products.slice(index, index + 2).map((product) => {
          const imageWidth = product.imageWidth || style.productImageWidth;
          const imageMargin =
            style.productAlignment === "center"
              ? "0 auto 10px"
              : style.productAlignment === "right"
                ? "0 0 10px auto"
                : "0 auto 10px 0";
          const price = product.showSalePrice !== false && product.salePrice
            ? '<span style="color:' + e(style.salePriceColor) + ";font-size:" + style.priceSize + 'px;font-weight:bold">' + e(product.salePrice) + "</span>"
            : "";
          const compare = product.showCompareAtPrice !== false && product.compareAtPrice
            ? ' <span style="color:' + e(style.textColor) + ';font-size:13px;text-decoration:line-through">' + e(product.compareAtPrice) + "</span>"
            : "";
          const button = product.showButton !== false
            ? '<div style="margin-top:13px"><a href="' + e(product.url) + '" style="display:inline-block;background:' + e(style.buttonBackground) + ";color:" + e(style.buttonTextColor) + ";border-radius:" + style.buttonRadius + 'px;padding:10px 14px;font-size:16px;font-weight:bold;text-decoration:none">' + e(product.button || "Shop now") + "</a></div>"
            : "";
          return (
            '<td class="reef-campaign-product" valign="top" width="50%" style="width:50%;padding:' +
            Math.round(style.productGap / 2) +
            "px;text-align:" +
            style.productAlignment +
            ';color:' +
            e(style.textColor) +
            '"><a href="' +
            e(product.url) +
            '" style="color:' +
            e(style.textColor) +
            ';text-decoration:none">' +
            (product.image
              ? '<img src="' + e(product.image) + '" alt="' + e(product.title) + '" width="' + imageWidth + '" style="display:block;width:' + imageWidth + 'px;max-width:100%;height:auto;margin:' + imageMargin + '">'
              : '<div style="height:' + imageWidth + 'px;background:#f1f3f3;color:#777;line-height:' + imageWidth + 'px;text-align:center">Product image</div>') +
            '<strong style="display:block;font-size:' +
            style.titleSize +
            'px;line-height:1.2">' +
            e(product.title) +
            "</strong></a><div style=\"margin-top:8px\">" +
            price +
            compare +
            "</div>" +
            button +
            "</td>"
          );
        });
        if (cells.length === 1)
          cells.push('<td class="reef-campaign-product" width="50%" style="width:50%">&nbsp;</td>');
        rows.push("<tr>" + cells.join("") + "</tr>");
      }
      return '<tr><td style="padding:' + style.sectionPadding + 'px;background:' + e(section.backgroundColor || style.contentBackground) + '"><table role="presentation" width="100%" style="table-layout:fixed"><tbody>' + rows.join("") + "</tbody></table></td></tr>";
    })
    .join("");
  const dynamicExpiry = c.couponExpiresAt
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "America/Los_Angeles",
      }).format(new Date(c.couponExpiresAt)) + " Pacific time"
    : "your personal expiration date";
  const dynamicCopy =
    c.bodyHtml !== undefined
      ? personalize(
          c.bodyHtml.replaceAll("{{ coupon_expires }}", dynamicExpiry),
          undefined,
          true,
        )
      : e(
          personalize(
            c.body.replaceAll("{{ coupon_expires }}", dynamicExpiry),
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
      e(c.heading) +
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
    '<body style="margin:0;background:' + e(style.emailBackground) + ";font-family:" + font + ";color:" + e(style.textColor) + '"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="100%" style="width:100%;max-width:600px;table-layout:fixed;background:' + e(style.contentBackground) + '"><tr><td style="display:none;max-height:0;overflow:hidden">' + e(c.preview || "") + "</td></tr>" +
    '<tr><td class="reef-logo" align="center" style="padding:16px 26px 8px">' +
    (c.logo
      ? '<img src="' + e(c.logo) + '" alt="' + e(organizationName) + '" width="' + Math.round(360 * (c.logoScale || 1)) + '" style="display:block;width:' + Math.round(360 * (c.logoScale || 1)) + 'px;max-width:100%;height:auto;margin:auto">'
      : '<strong style="font-size:27px;font-style:italic">' + e(organizationName.toUpperCase()) + "</strong>") +
    "</td></tr><tr><td style=\"padding:0 20px 8px\">" + nav + "</td></tr>" + hero + dynamicMessage + sections +
    '<tr><td style="padding:24px;background:#050505;color:#fff;text-align:center;font-size:12px;line-height:1.6">' +
    (c.footerImage
      ? '<img src="' + e(c.footerImage) + '" alt="" width="' + Math.round(560 * (c.footerScale || 1)) + '" style="display:block;max-width:100%;height:auto;margin:0 auto 14px">'
      : "") +
    (footerTitle(c)
      ? '<h2 style="margin:0 0 14px;color:#fff;font-size:18px">' + e(footerTitle(c)) + "</h2>"
      : "") +
    (c.facebookUrl || c.instagramUrl
      ? '<p style="margin:0 0 14px;font-size:25px">' +
        (c.facebookUrl
          ? '<a href="' + e(c.facebookUrl) + '" aria-label="Facebook" style="display:inline-block;color:#fff;text-decoration:none;margin:0 12px;vertical-align:middle">' +
            (c.facebookIcon
              ? '<img src="' + e(c.facebookIcon) + '" alt="" width="32" style="display:block;width:32px;max-width:32px;height:auto;border:0">'
              : "f") +
            "</a>"
          : "") +
        (c.instagramUrl
          ? '<a href="' + e(c.instagramUrl) + '" aria-label="Instagram" style="display:inline-block;color:#fff;text-decoration:none;margin:0 12px;vertical-align:middle">' +
            (c.instagramIcon
              ? '<img src="' + e(c.instagramIcon) + '" alt="" width="32" style="display:block;width:32px;max-width:32px;height:auto;border:0">'
              : "◎") +
            "</a>"
          : "") +
        "</p>"
      : "") +
    '<p style="margin:12px 0">' + e(c.footerText || "") .replace(/\n/g, "<br>") + "</p><p>" +
    e(c.footerUnsubscribeText || "No longer want to receive these emails?") +
    ' <a href="' + e(unsubscribe) + '" style="color:#fff">Unsubscribe</a></p><p>' + e(organizationName) + (address ? "<br>" + e(address) : "") + "</p>" +
    (footerCopyright(c, organizationName)
      ? '<p style="margin:12px 0 0">' + e(footerCopyright(c, organizationName)) + "</p>"
      : "") +
    "</td></tr></table></td></tr></table></body></html>"
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
    return campaignSaleHtml(c, unsubscribe, address, organizationName);
  if (layout === "welcome" || layout === "welcome-social") {
    const displayExpiry = c.couponExpiresAt
      ? new Intl.DateTimeFormat("en-US", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "America/Los_Angeles",
        }).format(new Date(c.couponExpiresAt)) + " Pacific time"
      : "your personal expiration date";
    c = {
      ...c,
      body: c.body.replaceAll("{{ coupon_expires }}", displayExpiry),
      bodyHtml: c.bodyHtml?.replaceAll("{{ coupon_expires }}", displayExpiry),
    };
    const social = layout === "welcome-social";
    const instagram =
      c.instagramUrl || "https://www.instagram.com/coralsanonymous/";
    const facebook =
      c.facebookUrl || "https://www.facebook.com/coralsanonymousshop/";
    const body =
      c.bodyHtml !== undefined
        ? personalize(c.bodyHtml, profileName, true)
        : e(personalize(c.body, profileName)).replace(/\n/g, "<br>");
    const expiry = c.couponExpiresAt
      ? '<p style="font-size:12px;color:#555">Expires ' +
        e(
          new Intl.DateTimeFormat("en-US", {
            dateStyle: "long",
            timeStyle: "short",
            timeZone: "America/Los_Angeles",
          }).format(new Date(c.couponExpiresAt)),
        ) +
        " Pacific time. One use. Cannot combine with other discounts.</p>"
      : "";
    const offer =
      c.couponCode && !social
        ? '<div style="text-align:center;padding:16px 0 28px"><h2 style="font-size:23px;margin:0 0 18px">' +
          (c.offerAboveBody ? "10% OFF Your Entire Order:" : "Discount Code:") +
          '</h2><span style="display:inline-block;border:2px solid #e6e6e6;border-radius:20px;padding:8px 16px;font-size:23px;font-weight:bold;overflow-wrap:anywhere">' +
          e(c.couponCode) +
          "</span>" +
          expiry +
          "</div>"
        : "";
    const hero = c.hero
      ? '<img src="' +
        e(c.hero) +
        '" alt="' +
        e(c.heading) +
        '" width="500" style="display:block;width:100%;max-width:500px;height:auto;margin:auto">'
      : !social
        ? '<div style="background:#8bd8e2;padding:44px 22px;text-align:center;border:1px solid #459ca4"><p style="font-size:25px;margin:0;color:#172e32;font-weight:bold">Aloha Friend,</p><p style="font-size:29px;line-height:1.25;font-weight:bold;margin:18px 0">' +
          (c.offerAboveBody
            ? "Thank you for subscribing<br>to our newsletter!"
            : "Save 10% off<br>your entire order!") +
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
      ';padding:28px 12px;color:white;text-decoration:none;text-align:center"><span style="font-size:12px;font-weight:bold">FOLLOW US ON</span><h2 style="font-size:23px;margin:12px 0">' +
      label +
      '</h2><span style="font-size:12px">' +
      handle +
      '</span><p style="font-weight:bold;font-size:16px;line-height:1.4;margin-top:28px">' +
      copy +
      "</p></a></td>";
    return (
      "<!doctype html><html>" +
      emailHead +
      '<body style="margin:0;background:#f7f7f7;font-family:Arial,sans-serif;color:#080808"><table role="presentation" width="100%"><tr><td class="reef-outer" align="center" style="padding:16px"><table role="presentation" width="100%" style="max-width:600px;table-layout:fixed;background:white"><tr><td style="display:none;font-size:1px;max-height:0;overflow:hidden">' +
      e(c.preview || "") +
      "</td></tr>" +
      (c.logo
        ? '<tr><td class="reef-logo" align="center" style="padding:20px"><img src="' +
          e(c.logo) +
          '" alt="' +
          e(organizationName) +
          '" width="' +
          Math.round(260 * (c.logoScale || 1)) +
          '" style="max-width:100%;height:auto"></td></tr>'
        : "") +
      '<tr><td style="padding:8px 30px 0">' +
      hero +
      '</td></tr><tr><td class="reef-copy" style="padding:16px 30px 24px;font-size:16px;line-height:1.4"><h1 style="text-align:center;font-size:28px;line-height:1.2;margin:0 0 22px">' +
      e(c.heading) +
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
            "INSTAGRAM",
            "@coralsanonymous",
            "DAILY CORAL POSTS, SALES, AND MORE!",
            "#c95379",
          ) +
          socialCard(
            facebook,
            "FACEBOOK",
            "@coralsanonymousshop",
            "CORAL SALES, PROMO CODES AND MORE!",
            "#606aff",
          ) +
          "</tr></table>"
        : "") +
      cartProductHtml(c) +
      '<p style="margin:26px 0 0;text-align:center"><a href="' +
      e(c.url) +
      '" style="display:block;border-radius:4px;background:#e69a49;padding:12px 16px;color:white;font-size:17px;font-weight:bold;text-decoration:none">' +
      e(c.button) +
      '</a></p></td></tr><tr><td style="background:#f7f7f7;padding:28px 20px;text-align:center;font-size:11px;line-height:1.6">' +
      (c.footerImage
        ? '<img src="' +
          e(c.footerImage) +
          '" alt="" width="' +
          Math.round(560 * (c.footerScale || 1)) +
          '" style="max-width:100%;height:auto">'
        : "") +
      (c.footerTitle
        ? '<h2 style="font-size:18px">' + e(c.footerTitle) + "</h2>"
        : "") +
      socialHtml({ ...c, instagramUrl: instagram, facebookUrl: facebook }) +
      (c.footerText
        ? "<p>" + e(c.footerText).replace(/\n/g, "<br>") + "</p>"
        : "") +
      "<p>" +
      e(c.footerUnsubscribeText || "No longer want to receive these emails?") +
      ' <a href="' +
      e(unsubscribe) +
      '" style="color:#555">Unsubscribe</a></p><p>' +
      e(organizationName) +
      (address ? "<br>" + e(address) : "") +
      "</p>" +
      (footerCopyright(c, organizationName)
        ? "<p>" + e(footerCopyright(c, organizationName)) + "</p>"
        : "") +
      "</td></tr></table></td></tr></table></body></html>"
    );
  }
  if (c.couponCode && layout !== "cart-recovery") {
    const line = "Your 10% discount code: " + c.couponCode;
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
      '<body style="background:#eff8f8;margin:0;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" class="reef-outer" style="padding:16px"><table role="presentation" width="100%" style="max-width:600px;table-layout:fixed;background:#8bd8e2"><tr><td class="reef-logo" style="background:white;padding:24px;text-align:center">' +
      '<span style="display:none;max-height:0;overflow:hidden;mso-hide:all">' +
      e(c.preview || "") +
      "</span>" +
      logo +
      '</td></tr><tr><td align="center" style="padding:0;background:#82d2dc"><table role="presentation" width="100%" style="width:100%;max-width:600px;table-layout:fixed"><tr><td class="reef-copy reef-cart-copy"' +
      (c.hero ? ' background="' + e(c.hero) + '"' : "") +
      ' style="padding:58px 42px 28px;text-align:center;color:white;background-color:#70b8c2;' +
      (c.hero
        ? "background-image:url(" +
          e(c.hero) +
          ");background-size:cover;background-position:center;"
        : "background-image:linear-gradient(135deg,#91d6dd,#5896a4,#91d6dd);") +
      '">' +
      '<h1 style="font-family:Georgia,serif;font-style:italic;font-size:30px;line-height:1.3;color:white;text-shadow:1px 2px 2px #173e46">' +
      e(c.heading) +
      '</h1><div style="font-family:Georgia,serif;font-style:italic;font-weight:bold;font-size:23px;line-height:1.55;color:white;text-shadow:1px 2px 2px #173e46">' +
      copy +
      "</div>" +
      (c.couponCode
        ? '<p style="font-size:14px;margin-top:30px">Use Discount Code:</p><p style="font-weight:bold;font-size:22px;overflow-wrap:anywhere">' +
          e(c.couponCode) +
          '</p><p style="font-size:12px">10% off your order. One use. Cannot combine with other discounts.</p>'
        : "") +
      '<p style="margin:30px 0 8px"><a href="' +
      e(c.url) +
      '" style="display:inline-block;max-width:100%;box-sizing:border-box;background:white;border-radius:32px;padding:16px 28px;color:#12333b;font-size:13px;font-weight:bold;text-decoration:none">' +
      e(c.button) +
      '</a></p></td></tr></table></td></tr><tr><td style="padding:8px 28px 24px;background:white;text-align:center">' +
      cartProductHtml(c) +
      '</td></tr><tr><td style="padding:26px;text-align:center;color:#254c53;font-size:12px;line-height:1.6">' +
      (c.footerImage
        ? '<img src="' +
          e(c.footerImage) +
          '" alt="" width="' +
          Math.round(560 * (c.footerScale || 1)) +
          '" style="max-width:100%;height:auto">'
        : "") +
      (c.footerTitle ? "<h2>" + e(c.footerTitle) + "</h2>" : "") +
      (c.footerText
        ? "<p>" + e(c.footerText).replace(/\n/g, "<br>") + "</p>"
        : "") +
      socialHtml(c) +
      "<p>" +
      e(organizationName) +
      "<br>" +
      e(address) +
      "</p>" +
      (footerCopyright(c, organizationName)
        ? "<p>" + e(footerCopyright(c, organizationName)) + "</p>"
        : "") +
      "<p>" +
      e(c.footerUnsubscribeText || "No longer want to receive these emails?") +
      ' <a style="color:#174f60" href="' +
      e(unsubscribe) +
      '">Unsubscribe</a></p></td></tr></table></td></tr></table></body></html>'
    );
  }
  if (layout === "b2b-wholesale") {
    const lines = c.body.split(String.fromCharCode(10));
    const greeting = personalize(
      lines[0] || 'Hi {{ first_name|default:"Friend" }}!',
      profileName,
    );
    const plainBody = e(lines.slice(2).join(String.fromCharCode(10)))
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
    const footerScale = Math.min(
      2.5,
      Math.max(
        0.25,
        Number(c.footerScale ?? (c.footerWidth ? c.footerWidth / 560 : 1)) || 1,
      ),
    );
    const logo = c.logo
      ? '<img src="' +
        e(c.logo) +
        '" alt="Corals Anonymous" style="max-width:100%;width:' +
        String(Math.round(260 * logoScale)) +
        'px;height:auto">'
      : '<div style="display:inline-block;padding:18px 26px;border:1px dashed #9aa8bb;color:#68778d;font-size:13px">Upload Corals Anonymous logo</div>';
    const footer = c.footerImage
      ? '<img src="' +
        e(c.footerImage) +
        '" alt="Thank you for your business" style="display:block;margin:0 auto;max-width:100%;width:' +
        String(Math.round(560 * footerScale)) +
        'px;height:auto;object-fit:contain">'
      : "";
    const footerCopy =
      (footerTitle(c)
        ? '<div style="margin-top:12px;font-size:29px;font-style:italic;font-weight:bold;color:white">' +
          e(footerTitle(c)) +
          "</div>"
        : "") +
      (c.footerText
        ? '<p style="margin:16px 0;color:white;font-size:14px;line-height:1.6">' +
          e(c.footerText).replace(/\n/g, "<br>") +
          "</p>"
        : "");
    return (
      "<!doctype html><html>" +
      emailHead +
      '<body style="margin:0;background:#07143a;font-family:Arial,sans-serif;color:#101820"><table role="presentation" width="100%"><tr><td align="center" class="reef-outer" style="padding:14px"><table role="presentation" width="100%" style="width:100%;max-width:600px;table-layout:fixed;background:white"><tr><td class="reef-logo" style="padding:12px 28px 18px;text-align:center">' +
      '<span style="display:none;max-height:0;overflow:hidden;mso-hide:all">' +
      e(c.preview || "") +
      "</span>" +
      logo +
      '<hr style="border:0;border-top:1px solid #c9c9c9;margin:14px 0 0"></td></tr><tr><td class="reef-copy" style="padding:36px 52px 24px;font-size:13px;line-height:1.55">' +
      (customBody
        ? bodyHtml
        : '<h1 style="text-align:center;font-size:27px;line-height:1.15;margin:0 0 45px">' +
          e(c.heading) +
          '</h1><p style="text-align:center;font-weight:bold;font-size:16px">' +
          e(greeting) +
          '</p><div style="font-size:13px;line-height:1.55">' +
          bodyHtml +
          "</div>") +
      productHtml(c) +
      '</td></tr><tr><td style="padding:0 15px 8px;text-align:center"><a style="display:block;background:#ee984e;color:white;text-decoration:none;padding:13px 18px;font-weight:bold;font-size:16px" href="' +
      e(c.url) +
      '">' +
      e(c.button) +
      '</a></td></tr><tr><td style="padding:12px 18px 30px;background:#244b7b;text-align:center">' +
      footer +
      footerCopy +
      socialHtml(c) +
      '<p style="margin:18px 0 0;color:#9fb5d2;font-size:11px">' +
      e(organizationName) +
      '</p><p style="margin:5px 0 0;color:#d7e3f2;font-size:12px">' +
      e(c.footerUnsubscribeText ?? "No longer want to receive these emails?") +
      ' <a style="color:#ffd0a3" href="' +
      e(unsubscribe) +
      '">Unsubscribe</a></p><p style="margin:5px 0 0;color:#d7e3f2;font-size:12px">' +
      (address ? e(address) : "") +
      "</p>" +
      (footerCopyright(c, organizationName)
        ? '<p style="margin:5px 0 0;color:#d7e3f2;font-size:12px">' +
          e(footerCopyright(c, organizationName)) +
          "</p>"
        : "") +
      "</td></tr></table></td></tr></table></body></html>"
    );
  }
  return (
    "<!doctype html><html>" +
    emailHead +
    '<body style="margin:0;background:#eef5f4;font-family:Arial,sans-serif;color:#123334"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="100%" style="width:100%;max-width:600px;table-layout:fixed;background:white"><tr><td style="padding:28px;text-align:center;background:#083b3b;color:white;font-size:25px;font-weight:bold">CORALS ANONYMOUS</td></tr><tr><td style="display:none">' +
    e(c.preview || "") +
    "</td></tr>" +
    (c.hero
      ? '<tr><td><a href="' +
        e(c.url) +
        '"><img src="' +
        e(c.hero) +
        '" alt="' +
        e(c.heading) +
        '" width="600" style="max-width:100%"></a></td></tr>'
      : "") +
    '<tr><td class="reef-copy" style="padding:28px"><h1>' +
    e(c.heading) +
    '</h1><div style="line-height:1.7">' +
    (c.bodyHtml !== undefined
      ? personalize(c.bodyHtml, profileName, true)
      : e(personalize(c.body, profileName)).replace(/\n/g, "<br>")) +
    productHtml(c) +
    '</div><p><a style="display:inline-block;background:#087f78;padding:16px 24px;color:white" href="' +
    e(c.url) +
    '">' +
    e(c.button) +
    '</a></p></td></tr><tr><td style="padding:24px;font-size:12px;text-align:center">' +
    (footerTitle(c) ? "<strong>" + e(footerTitle(c)) + "</strong><br>" : "") +
    (c.footerText
      ? "<p>" + e(c.footerText).replace(/\n/g, "<br>") + "</p>"
      : "") +
    socialHtml(c) +
    e(organizationName) +
    "<br>" +
    e(address) +
    (footerCopyright(c, organizationName)
      ? "<br>" + e(footerCopyright(c, organizationName))
      : "") +
    "<br>" +
    e(c.footerUnsubscribeText ?? "") +
    ' <a href="' +
    e(unsubscribe) +
    '">Unsubscribe from email marketing</a></td></tr></table></td></tr></table></body></html>'
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
