import type { Content } from "./rules";
import { escapeHtml, imageSource, personalize, couponExpiryDate, couponTimeLeft, footerCopyright, defaultGeneratedEmailCopy } from "./rules";

const ASSETS = "https://reef-ops-dashboard-production.up.railway.app/";
export type ReefDesign = {
  version: 1;
  variant: "cart" | "gift" | "message" | "social";
  offerPercent?: 10 | 15;
  eyebrow?: string;
  offerTitle?: string;
  offerScope?: string;
  productsTitle?: string;
  closing?: string;
  signature?: string;
  logo?: string;
  logoScale?: number;
  backgroundColor?: string;
  accentColor?: string;
  headingSize?: number;
};
export function reefDesignDefaults(variant: ReefDesign["variant"]) {
  return { version: 1 as const, variant, eyebrow: variant === "gift" ? "FROM OUR REEF TO YOURS" : "",
    offerTitle: "A GIFT JUST FOR YOU", offerScope: "YOUR NEXT ORDER", productsTitle: "Your Reef Picks",
    closing: "Happy Reefing!", signature: "THE CORALS ANONYMOUS TEAM", logo: ASSETS + "ca-reef-logo-v1.png",
    logoScale: 1, backgroundColor: "#e0f4f9", accentColor: "#f2643f", headingSize: variant === "cart" ? 48 : 36 };
}
export function normalizeReefDesign(value: unknown): ReefDesign | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw Error("Choose a valid Corals flow design.");
  const v = value as Partial<ReefDesign>;
  if (v.version !== 1 || !["cart", "gift", "message", "social"].includes(v.variant || "")) throw Error("Choose a valid Corals flow design.");
  const d: ReefDesign = { ...reefDesignDefaults(v.variant!), ...(v.offerPercent === 10 || v.offerPercent === 15 ? { offerPercent: v.offerPercent } : {}) };
  for (const [key, max] of Object.entries({ eyebrow: 120, offerTitle: 120, offerScope: 160, productsTitle: 120, closing: 120, signature: 160 }) as ["eyebrow" | "offerTitle" | "offerScope" | "productsTitle" | "closing" | "signature", number][])
    if (v[key] !== undefined) d[key] = String(v[key]).slice(0, max);
  if (v.logo !== undefined) d.logo = v.logo === "" ? "" : imageSource(v.logo);
  for (const key of ["backgroundColor", "accentColor"] as const)
    if (v[key] !== undefined && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(v[key]!)) d[key] = v[key];
  if (v.headingSize !== undefined && Number.isFinite(Number(v.headingSize))) d.headingSize = Math.max(24, Math.min(64, Number(v.headingSize)));
  if (v.logoScale !== undefined && Number.isFinite(Number(v.logoScale))) d.logoScale = Math.max(0.25, Math.min(2.5, Number(v.logoScale)));
  return d;
}

/** Presentation only: no copy, subject, template, feed, coupon or timing rewrites. */
export function applyCoralsReefDesign(c: Content, flowKey: string, stepIndex = 0, branch?: "yes" | "no"): Content {
  const variant: ReefDesign["variant"] = flowKey === "abandoned-cart"
    ? branch === "yes" ? "message" : stepIndex > 0 || branch === "no" ? "gift" : "cart"
    : flowKey === "welcome" ? stepIndex >= 3 || c.template === "welcome-social" ? "social" : "gift" : "message";
  return { ...c, layout: "corals-reef", reefDesign: c.reefDesign?.version === 1 ? c.reefDesign : {
    ...reefDesignDefaults(variant), ...(variant === "gift" ? { offerPercent: flowKey === "abandoned-cart" && stepIndex === 2 ? 15 as const : 10 as const } : {}),
  } };
}

/** Resolve the same implicit social copy as the original Welcome layout, after shared branding. */
export function resolveReefSocialContent(c: Content): Content {
  if (c.template !== "welcome-social" && c.reefDesign?.variant !== "social") return c;
  return { ...c,
    socialFollowText: c.socialFollowText ?? defaultGeneratedEmailCopy.socialFollow,
    instagramUrl: c.instagramUrl ?? defaultGeneratedEmailCopy.instagramUrl,
    instagramHeading: c.instagramHeading ?? defaultGeneratedEmailCopy.instagramHeading,
    instagramHandle: c.instagramHandle ?? defaultGeneratedEmailCopy.instagramHandle,
    instagramText: c.instagramText ?? defaultGeneratedEmailCopy.instagramText,
    facebookUrl: c.facebookUrl ?? defaultGeneratedEmailCopy.facebookUrl,
    facebookHeading: c.facebookHeading ?? defaultGeneratedEmailCopy.facebookHeading,
    facebookHandle: c.facebookHandle ?? defaultGeneratedEmailCopy.facebookHandle,
    facebookText: c.facebookText ?? defaultGeneratedEmailCopy.facebookText,
    socialNavigation: c.socialNavigation ?? [
      { label: "🔥 New Corals", url: "https://coralsanonymous.com/collections/new-arrivals" },
      { label: "🏷️ Deal Busters", url: "https://coralsanonymous.com/collections/deal-busters" },
      { label: "✚ Earn Points & Save!", url: "https://coralsanonymous.com/pages/rewards" },
    ],
  };
}

/** Hybrid columns wrap without media queries; Outlook gets conditional fixed cells. */
function productCards(c: Content, d: ReefDesign, profileName?: string) {
  if (!c.products?.length) return "";
  const e = escapeHtml;
  const cards = c.products.map((p, index) =>
    (index % 2 === 0 ? '<!--[if mso]><tr><![endif]-->' : "") +
    '<!--[if mso]><td width="268" valign="top"><![endif]--><div class="cr-product" style="display:inline-block;width:100%;max-width:268px;vertical-align:top;box-sizing:border-box;padding:0 8px 18px;text-align:center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#ffffff;border-radius:17px;box-shadow:0 3px 7px #123b4914;table-layout:fixed"><tr><td>' +
    (p.image ? '<a href="' + e(p.url) + '"><img src="' + e(p.image) + '" alt="' + e(p.title) + '" width="252" style="display:block;width:100%;height:auto;border:0;border-radius:17px 17px 12px 12px"></a>' : "") +
    '</td></tr><tr><td style="padding:10px 8px 12px;word-wrap:break-word;overflow-wrap:anywhere"><a href="' + e(p.url) + '" style="font-family:Arial,sans-serif;font-weight:700;color:#073a49;font-size:18px;line-height:1.25;text-decoration:none">' + e(p.title) + '</a>' +
    (p.price ? '<p style="font-size:23px;line-height:1.2;font-weight:800;color:#148a94;margin:8px 0 0">' + e(p.price) + '</p>' : "") +
    (p.compareAtPrice ? '<p style="font-size:12px;color:#6d8086;margin:4px 0 0;text-decoration:line-through">' + e(p.compareAtPrice) + '</p>' : "") +
    '</td></tr></table></div><!--[if mso]></td>' + (index % 2 === 1 || index === c.products!.length - 1 ? '</tr>' : '') + '<![endif]-->').join("");
  return '<tr><td style="padding:0 18px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-radius:24px;background:#ffffff;table-layout:fixed"><tr><td style="padding:24px 8px 8px;text-align:center">' +
    (d.productsTitle ? '<h2 style="font-size:28px;line-height:1.2;color:#073a49;margin:0 0 24px;font-weight:800">' + e(personalize(d.productsTitle, profileName)) + '</h2>' : '') +
    '<div style="font-size:0;text-align:center"><!--[if mso]><table role="presentation" width="536" cellpadding="0" cellspacing="0"><![endif]-->' + cards + '<!--[if mso]></table><![endif]--></div></td></tr></table></td></tr>';
}

export function renderCoralsReef(c: Content, unsubscribe: string, address: string, profileName?: string, organizationName = "Corals Anonymous") {
  c = resolveReefSocialContent(c);
  const e = escapeHtml, d: ReefDesign = normalizeReefDesign(c.reefDesign) || reefDesignDefaults("message");
  const bg = e(d.backgroundColor || "#e0f4f9"), accent = e(d.accentColor || "#f2643f");
  const expiry = c.couponExpiresAt ? couponExpiryDate(c.couponExpiresAt) : c.couponExpiryFallbackText ?? defaultGeneratedEmailCopy.couponExpiryFallback;
  const expand = (text: string, html = false) => personalize(text.replaceAll("{{ coupon_expires }}", html ? e(expiry) : expiry)
    .replaceAll("{{ coupon_time_left }}", couponTimeLeft(c.couponExpiresAt)), profileName, html);
  const body = c.bodyHtml !== undefined ? expand(c.bodyHtml, true) : e(expand(c.body)).replaceAll("\n", "<br>");
  const ownHeading = c.template === "b2b-wholesale" && c.bodyHtml !== undefined && /<h[1-6]\b|\{\{\s*first_name/.test(c.bodyHtml);
  const offerPercent = c.template === "welcome" ? 10 : d.offerPercent === 15 ? 15 : 10;
  const terms = c.couponTerms ?? (c.template === "cart-recovery" ? defaultGeneratedEmailCopy.cartCouponTerms.replace(/10\s*%/g, offerPercent + "%") : defaultGeneratedEmailCopy.welcomeCouponTerms);
  const offer = c.couponCode && d.variant === "gift"
    ? '<tr><td style="padding:0 18px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:24px;border-collapse:separate;box-shadow:0 12px 25px #0b3b4912;table-layout:fixed"><tr><td style="padding:25px 12px;text-align:center">' +
      (d.offerTitle ? '<p style="font-size:17px;color:#157c88;font-weight:700;margin:0 0 12px">' + e(expand(d.offerTitle)) + '</p>' : '') +
      '<div style="font-size:0;text-align:center"><!--[if mso]><table role="presentation" align="center" width="420"><tr><td width="85"><![endif]--><div style="display:inline-block;width:85px;max-width:100%;vertical-align:middle"><img src="' + ASSETS + 'ca-reef-gift-v1.png" alt="" width="85" style="display:block;width:85px;max-width:100%;height:auto"></div><!--[if mso]></td><td width="335"><![endif]--><div style="display:inline-block;width:100%;max-width:335px;vertical-align:middle;text-align:center;padding:0 4px;box-sizing:border-box"><p class="cr-offer" style="font-size:54px;line-height:1;font-weight:800;letter-spacing:-2px;color:#073a49;margin:0;overflow-wrap:anywhere">' + offerPercent + '% OFF</p>' +
      (d.offerScope ? '<p style="font-size:19px;line-height:1.2;color:' + accent + ';font-weight:700;margin:8px 0 0">' + e(expand(d.offerScope)) + '</p>' : '') +
      '</div><!--[if mso]></td></tr></table><![endif]--></div><p style="font-size:14px;color:#49646e;line-height:1.5;margin:22px 0 0;word-wrap:break-word;overflow-wrap:anywhere">' +
      e(c.couponLabel ?? "Your gift code:") + ' <strong style="color:#073a49">' + e(c.couponCode) + '</strong></p>' +
      (terms ? '<p style="font-size:11px;line-height:1.5;color:#647b83;margin:10px 8px 0">' + e(expand(terms)) + '</p>' : '') +
      (c.couponExpiresAt && c.couponExpiryText !== '' ? '<p style="font-size:11px;line-height:1.5;color:#647b83;margin:7px 8px 0">' + e((c.couponExpiryText ?? defaultGeneratedEmailCopy.couponExpiry).replaceAll("{{ coupon_expires }}", expiry)) + '</p>' : '') +
      '</td></tr></table></td></tr>' : '';
  const social = d.variant === "social" ? '<tr><td style="padding:0 26px 24px">' +
    (c.socialFollowText ? '<p style="font-size:18px;text-align:center;color:#49646e">' + e(c.socialFollowText) + '</p>' : '') +
    [[c.instagramUrl, c.instagramHeading, c.instagramHandle, c.instagramText], [c.facebookUrl, c.facebookHeading, c.facebookHandle, c.facebookText]]
      .filter(([url]) => url).map(([url, heading, handle, copy]) => '<table role="presentation" width="100%" style="background:#ffffff;border-radius:18px;margin:0 0 14px"><tr><td style="padding:22px;text-align:center"><a href="' + e(url!) + '" style="display:block;color:#073a49;text-decoration:none">' + (heading ? '<p style="font-size:22px;font-weight:bold">' + e(heading) + '</p>' : '') + (handle ? '<p style="font-size:13px;color:#168591">' + e(handle) + '</p>' : '') + (copy ? '<p style="font-size:15px;line-height:1.5;color:#49646e">' + e(copy) + '</p>' : '') + '</a></td></tr></table>').join('') +
      (c.socialNavigation?.length ? '<p style="text-align:center;font-size:13px;line-height:2">' + c.socialNavigation.map(link=>'<a href="'+e(link.url)+'" style="color:#157c88;margin:0 7px">'+e(link.label)+'</a>').join(' ')+'</p>' : '') + '</td></tr>' : '';
  const button = '<tr><td style="padding:0 42px 24px;text-align:center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="' + accent + '" style="background:' + accent + ';border-radius:40px"><a href="' + e(c.url) + '" style="display:block;padding:18px 12px;border:1px solid ' + accent + ';border-radius:40px;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:23px;line-height:1.25;font-weight:800;word-wrap:break-word">' + e(c.button) + ' <span aria-hidden="true">&#8594;</span></a></td></tr></table></td></tr>';
  const compliance = '<tr><td style="padding:14px 28px 24px;text-align:center;font-size:11px;line-height:1.7;color:#53727d;word-wrap:break-word">' +
    (c.footerText ? '<div>' + e(c.footerText).replaceAll('\n','<br>') + '</div>' : '') +
    '<div>' + e(c.footerUnsubscribeText ?? defaultGeneratedEmailCopy.unsubscribeIntro) + ' <a href="' + e(unsubscribe) + '" style="color:#073a49;text-decoration:underline">' + e(c.footerUnsubscribeLinkText || defaultGeneratedEmailCopy.unsubscribeLink) + '</a></div>' +
    (c.showPostalAddress && address ? '<div>' + e(organizationName) + '<br>' + e(address).replaceAll('\n','<br>') + '</div>' : '') +
    (c.showFooterCopyright !== false ? '<div>' + e(footerCopyright(c, organizationName)) + '</div>' : '') +
    (c.showFooterSocial !== false ? '<div>' + [[c.instagramUrl,'Instagram'],[c.facebookUrl,'Facebook']].filter(([url])=>url).map(([url,label])=>'<a href="'+e(url!)+'" style="color:#157c88;margin:0 8px">'+label+'</a>').join(' ') + '</div>' : '') + '</td></tr>';
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><style>body,table,td,a{font-family:Arial,Helvetica,sans-serif}table{border-spacing:0}img{border:0}p{margin:0 0 12px}a{word-wrap:break-word}@media(max-width:560px){.cr-product{max-width:100%!important;padding-left:4px!important;padding-right:4px!important}.cr-heading{font-size:32px!important}.cr-offer{font-size:40px!important;letter-spacing:-1px!important}.cr-copy{padding-left:22px!important;padding-right:22px!important}}</style></head>' +
    '<body style="margin:0;padding:0;background:' + bg + ';color:#073a49;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="' + bg + '"><tr><td align="center"><!--[if mso]><table role="presentation" width="600"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;table-layout:fixed;background:' + bg + '">' +
    '<tr><td style="display:none;max-height:0;overflow:hidden;mso-hide:all">' + e(expand(c.preview || '')) + '</td></tr>' +
    '<tr><td align="center" background="'+ASSETS+'ca-reef-header-waves-v1.png" style="padding:14px 22px 22px;background-color:' + bg + ';background-image:url('+ASSETS+'ca-reef-header-waves-v1.png);background-size:100% 100%;background-position:center bottom">' + (d.logo ? '<img src="' + e(d.logo) + '" width="' + Math.round(300 * (d.logoScale ?? 1)) + '" alt="' + e(organizationName) + '" style="display:block;width:' + Math.round(300 * (d.logoScale ?? 1)) + 'px;max-width:100%;height:auto;margin:auto">' : '') + '</td></tr>' +
    '<tr><td class="cr-copy" style="padding:10px 35px 24px;text-align:center">' + (!ownHeading ? '<h1 class="cr-heading" style="font-size:' + d.headingSize + 'px;line-height:1.13;letter-spacing:-1px;font-weight:800;' + (d.variant === 'cart' ? 'font-style:italic;' : '') + 'margin:0 0 10px;color:#073a49;word-wrap:break-word;overflow-wrap:anywhere">' + e(expand(c.heading)) + '</h1>' : '') +
    (d.eyebrow ? '<p style="font-size:14px;line-height:1.4;font-weight:700;color:#157c88;margin:0 0 12px">' + e(expand(d.eyebrow)) + '</p>' : '') +
    '<table role="presentation" align="center" width="130"><tr><td height="5" bgcolor="' + (d.variant === 'cart' ? '#f7c728' : accent) + '" style="height:5px;background:' + (d.variant === 'cart' ? '#f7c728' : accent) + ';border-radius:5px"></td></tr></table>' +
    (c.hero ? '<img src="'+e(c.hero)+'" alt="" width="500" style="width:100%;max-width:500px;height:auto;margin:20px auto 0;display:block;border-radius:18px">' : '') +
    '<div style="font-size:18px;line-height:1.48;color:#49646e;margin:22px 0 0;word-wrap:break-word;overflow-wrap:anywhere">' + (!ownHeading && c.introText ? '<p style="font-weight:700">'+e(expand(c.introText))+'</p>' : '') + body + '</div></td></tr>' + offer + social + productCards(c,d,profileName) + button +
    '<tr><td align="center" style="padding:0 20px 10px">' + (d.closing ? '<p style="font-size:34px;font-weight:800;font-style:italic;letter-spacing:-1px;line-height:1.2;color:#073a49;margin:0 0 9px">' + e(expand(d.closing)) + '</p>' : '') +
    (d.signature ? '<p style="font-size:14px;font-weight:700;color:#073a49;letter-spacing:1px;margin:0">' + e(expand(d.signature)) + '</p>' : '') + '</td></tr>' + compliance +
    '<tr><td><img src="'+ASSETS+'ca-reef-footer-waves-v1.png" alt="" width="600" style="display:block;width:100%;height:auto;border:0"></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>';
}
