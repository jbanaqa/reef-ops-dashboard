import { FilterXSS } from "xss";
import { decode } from "he";
export const channels = [
  "EMAIL",
  "SMS_MARKETING",
  "SMS_TRANSACTIONAL",
] as const;
export type Channel = (typeof channels)[number];
export type Content = {
  heading: string;
  body: string;
  bodyHtml?: string;
  button: string;
  url: string;
  hero?: string;
  preview?: string;
  template?: "standard" | "b2b-wholesale" | "cart-recovery";
  couponCode?: string;
  logo?: string;
  logoScale?: number;
  footerImage?: string;
  footerScale?: number;
  footerTitle?: string;
  showPostalAddress?: boolean;
  footerText?: string;
  footerUnsubscribeText?: string;
  /** @deprecated Older saved flows may still contain these pixel values. */ logoWidth?: number;
  logoHeight?: number;
  footerWidth?: number;
  footerHeight?: number;
  products?: { title: string; url: string; image?: string; price?: string }[];
};
export type MarketingOperations = {
  sendingEnabled: boolean;
  migrationConfirmed: boolean;
  ingestEnabled: boolean;
  formEnabled: boolean;
};
export type MarketingSettings = {
  postalAddress: string;
  organizationName: string;
  operations: MarketingOperations;
};
export const defaultMarketingSettings: MarketingSettings = {
  postalAddress: "",
  organizationName: "Corals Anonymous",
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
  return {
    postalAddress: String(v.postalAddress ?? fallbackAddress).slice(0, 500),
    organizationName: String(
      v.organizationName || defaultMarketingSettings.organizationName,
    ).slice(0, 120),
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
    c.bodyHtml !== undefined ? htmlText(c.bodyHtml) : c.body,
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
    const cells = products.slice(i, i + 2).map((p) =>
      '<td valign="top" width="50%" style="width:50%;padding:12px 8px 18px;text-align:center">' +
      '<a href="' + escapeHtml(p.url) + '" style="color:#122f35;text-decoration:none">' +
      (p.image
        ? '<img src="' + escapeHtml(p.image) + '" width="240" alt="' + escapeHtml(p.title) + '" style="display:block;width:100%;max-width:240px;height:auto;margin:0 auto 9px;background:#f1f4f4">'
        : '<div style="width:100%;height:150px;background:#f1f4f4;margin:0 auto 9px;color:#7b8789;font-size:12px;line-height:150px">Product image</div>') +
      '<strong style="display:block;font-family:Georgia,serif;font-size:16px;line-height:1.25;text-decoration:underline">' +
      escapeHtml(p.title) +
      '</strong>' +
      (p.price ? '<span style="display:block;margin-top:7px;color:#0b9b91;font-size:14px">' + escapeHtml(p.price) + '</span>' : "") +
      '</a></td>',
    );
    if (cells.length === 1) cells.push('<td width="50%" style="width:50%;padding:12px 8px 18px">&nbsp;</td>');
    rows.push('<tr>' + cells.join("") + '</tr>');
  }
  return '<table role="presentation" class="reef-cart-products" width="100%" style="width:100%;border-collapse:collapse;table-layout:fixed;border-top:1px solid #71cbd2;margin-top:18px"><tbody>' + rows.join("") + '</tbody></table>';
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
    hero: c.hero ? safeUrl(c.hero) : undefined,
    preview: String(c.preview || "").slice(0, 200),
    template:
      c.template === "cart-recovery"
        ? "cart-recovery"
        : c.template === "b2b-wholesale"
          ? "b2b-wholesale"
          : "standard",
    couponCode: c.couponCode ? String(c.couponCode).slice(0, 100) : undefined,
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
    footerScale: c.footerImage
      ? scale(c.footerScale, c.footerWidth, 560)
      : undefined,
    products: (c.products || []).slice(0, 12).map((p) => ({
      title: String(p.title).slice(0, 200),
      url: safeUrl(p.url),
      image: p.image ? safeUrl(p.image) : undefined,
      price: String(p.price || "").slice(0, 80),
    })),
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
  return (
    c.footerTitle ??
    (c.template === "b2b-wholesale" && !c.footerImage
      ? "Thank you for your business"
      : "")
  );
}
const emailHead =
  '<head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%!important}table{border-spacing:0}img{max-width:100%!important;height:auto}td{overflow-wrap:anywhere;word-break:normal}.reef-copy *{max-width:100%;box-sizing:border-box;overflow-wrap:anywhere}.reef-copy a{word-break:break-word}@media only screen and (max-width:480px){.reef-outer{padding:8px!important}.reef-copy{padding:24px 20px!important;font-size:15px!important}.reef-copy div,.reef-copy p,.reef-copy li{font-size:15px!important;line-height:1.6!important}.reef-copy h1{font-size:25px!important;line-height:1.2!important;margin-bottom:24px!important}.reef-logo{padding:16px 20px!important}}</style></head>';

export function render(
  c: Content,
  unsubscribe: string,
  address: string,
  profileName?: string,
  organizationName = "Corals Anonymous",
) {
  c = content(c);
  address = c.showPostalAddress ? address : "";
  const e = escapeHtml;
  if (c.couponCode && c.template !== "cart-recovery") {
    const line = "Your 10% discount code: " + c.couponCode;
    c = {
      ...c,
      body: c.body + "\n\n" + line,
      ...(c.bodyHtml !== undefined
        ? { bodyHtml: c.bodyHtml + "<p>" + e(line) + "</p>" }
        : {}),
    };
  }
  if (c.template === "cart-recovery") {
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
      (c.hero ? 'background-image:url(' + e(c.hero) + ');background-size:cover;background-position:center;' : 'background-image:linear-gradient(135deg,#91d6dd,#5896a4,#91d6dd);') +
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
      "<p>" +
      e(organizationName) +
      "<br>" +
      e(address) +
      "</p><p>" +
      e(c.footerUnsubscribeText || "No longer want to receive these emails?") +
      ' <a style="color:#174f60" href="' +
      e(unsubscribe) +
      '">Unsubscribe</a></p></td></tr></table></td></tr></table></body></html>'
    );
  }
  if (c.template === "b2b-wholesale") {
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
      '<p style="margin:18px 0 0;color:#9fb5d2;font-size:11px">' +
      e(organizationName) +
      '</p><p style="margin:5px 0 0;color:#d7e3f2;font-size:12px">' +
      e(c.footerUnsubscribeText ?? "No longer want to receive these emails?") +
      ' <a style="color:#ffd0a3" href="' +
      e(unsubscribe) +
      '">Unsubscribe</a></p><p style="margin:5px 0 0;color:#d7e3f2;font-size:12px">' +
      (address ? e(address) : "") +
      "</p></td></tr></table></td></tr></table></body></html>"
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
    e(organizationName) +
    "<br>" +
    e(address) +
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
export const flowDefaults = [
  {
    key: "delivery-upsell",
    name: "24 Hour Notice | Upsell",
    trigger: "DELIVERY_SCHEDULED",
    description:
      "Schedule 24 hours before a trusted expected-delivery timestamp. Requires delivery-source mapping.",
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
      "Once per profile after new email signup; configured first-order coupon in the first message. Review subsequent delays and copy.",
    delays: [0, 1440, 4320],
  },
] as const;
