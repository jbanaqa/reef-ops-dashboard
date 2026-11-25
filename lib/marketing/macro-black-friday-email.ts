import { MACRO_BLACK_FRIDAY_URL, MACROALGAE_STOREFRONT } from "./macro-black-friday";
import type { CampaignEmailProduct, Content } from "./rules";

type EmailOptions = {
  assetBaseUrl: string;
  unsubscribe: string;
  address: string;
  organizationName: string;
};

const navy = "#121b2a";
const gold = "#efe7cb";
const paper = "#fbf9f3";
const ink = "#192639";
const saleBlue = "#244f87";
const copy = "#f6f4ee";
const muted = "#526071";
const badge = "#eee2c0";
const outer = "#e8edf0";
const border = "#d7d4ca";
const font = "Arial,Helvetica,sans-serif";
const presentation = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const storeUrl = MACROALGAE_STOREFRONT.replace(/\/$/, "") + "/";
const shopLabel = "Shop Black Friday";
const headline = "Black Friday Sale";
const storeName = "Macroalgae Farms";

const entities: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
const escape = (text: string) => text.replace(/[&<>"']/g, (character) => entities[character]);
const lineBreaks = (text: string) => text.replace(/\r\n?|\n/g, "<br>");

function emailHead(mobileHero: string) {
  return `<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light only">
    <title>${headline} | ${storeName}</title>
    <style>
      :root {color-scheme:light only;supported-color-schemes:light only}
      body,table,td,a {-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
      table {border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt}
      img {border:0}
      @media screen and (max-width:620px) {
        .mbf-outer {padding:0!important}
      }
      @media screen and (max-width:520px) {
        .mbf-inset {padding-left:20px!important;padding-right:20px!important}
        .mbf-hero {background-image:url('${escape(mobileHero)}')!important;background-position:center!important}
        .mbf-masthead {padding-top:12px!important;padding-bottom:10px!important;border-top:0!important}
        .mbf-hero-copy {padding-top:12px!important;padding-bottom:24px!important}
        .mbf-hero-text {max-width:325px!important;font-size:13px!important;line-height:18px!important}
        .mbf-featured-group {padding-top:18px!important}
        .mbf-small-group {padding-top:17px!important}
        .mbf-featured {display:block!important;width:100%!important;max-width:100%!important}
        .mbf-featured + .mbf-featured {margin-top:14px!important;padding-top:14px!important;border-top:1px solid ${border}!important}
        .mbf-product {width:50%!important;max-width:50%!important}
        .mbf-featured-img {aspect-ratio:1.6!important;object-position:center 44%!important}
        .mbf-grid-img {aspect-ratio:1.18!important}
        .mbf-featured .mbf-title {font-size:17px!important;line-height:21px!important;min-height:0!important}
        .mbf-product .mbf-title {min-height:36px!important;font-size:13px!important;line-height:16px!important}
        .mbf-product .mbf-price {font-size:14px!important}
        .mbf-product .mbf-discount {display:inline-block!important}
      }
      @media screen and (max-width:370px) {
        .mbf-product .mbf-price {font-size:13px!important}
        .mbf-product .mbf-compare {font-size:10px!important;margin-left:2px!important}
        .mbf-product .mbf-discount {padding-left:3px!important;padding-right:3px!important}
      }
      @media screen and (max-width:355px) {
        .mbf-inset {padding-left:14px!important;padding-right:14px!important}
        .mbf-hero-copy {padding-top:14px!important}
      }
      @media (prefers-color-scheme:dark) {
        .mbf-light {background-color:${paper}!important;color:${ink}!important}
        .mbf-dark {background-color:${navy}!important;color:${gold}!important}
        .mbf-cta {background-color:${gold}!important;color:${navy}!important}
      }
    </style>
    <!--[if mso]><style>.mbf-featured,.mbf-product {width:100%!important;min-width:0!important;max-width:none!important}</style><![endif]-->
  </head>`;
}

function shopButton() {
  return `<table ${presentation}>
    <tr><td class="mbf-cta" bgcolor="${gold}" style="background-color:${gold};mso-padding-alt:9px 16px;">
      <a class="mbf-cta" href="${escape(MACRO_BLACK_FRIDAY_URL)}" style="display:inline-block;padding:9px 16px;color:${navy};font:700 13px/19px ${font};text-decoration:none;">${shopLabel}&nbsp;&nbsp; <span aria-hidden="true">&rarr;</span></a>
    </td></tr>
  </table>`;
}

function hero(assets: string, body: string) {
  const photo = escape(assets + "macro-hero-v1.jpg");
  const intro = /^up to 50% off\b/i.exec(body);
  const rest = body.slice(intro?.[0].length ?? 0);
  const copyText = lineBreaks(escape(rest)).replace("red and blue macroalgae", "red&nbsp;and&nbsp;blue&nbsp;macroalgae");
  const bodyHtml = intro
    ? `<strong style="color:${gold};">${escape(intro[0])}</strong>${copyText}`
    : copyText;
  return `<tr>
    <td class="mbf-hero mbf-dark" bgcolor="${navy}" background="${photo}" style="background-color:${navy};background-image:url('${photo}');background-repeat:no-repeat;background-size:cover;background-position:center center;">
      <!--[if gte mso 9]>
      <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;">
      <v:fill type="frame" src="${photo}" color="${navy}" />
      <v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:true;">
      <![endif]-->
      <table ${presentation} width="100%" style="width:100%;table-layout:fixed;">
        <tr><td class="mbf-inset mbf-masthead" style="padding:13px 43px 11px;border-top:4px solid ${gold};">
          <a href="${escape(storeUrl)}" style="display:inline-block;color:${gold};font:700 16px/1.1 ${font};text-decoration:none;">
            <img src="${escape(assets + "macro-logo-v1.png")}" alt="Macroalgae Farms - Seaweed Aquaculture" width="141" height="48" style="display:block;width:141px;height:48px;color:${gold};border:0;">
          </a>
        </td></tr>
        <tr><td class="mbf-inset mbf-hero-copy" style="padding:15px 43px 31px;">
          <h1 style="margin:0 0 12px;font:800 38px/1.15 ${font};color:${gold};">
            <img src="${escape(assets + "macro-headline-v1.png")}" alt="${headline}" width="426" height="64" style="display:block;width:89.2%;max-width:426px;height:auto;border:0;color:${gold};font:800 27px/1.15 ${font};">
          </h1>
          ${bodyHtml ? `<p class="mbf-hero-text" style="margin:0 0 14px;max-width:418px;color:${copy};font:14px/19px ${font};overflow-wrap:anywhere;">${bodyHtml}</p>` : ""}
          ${shopButton()}
        </td></tr>
      </table>
      <!--[if gte mso 9]></v:textbox></v:rect><![endif]-->
    </td>
  </tr>`;
}

function productPrice(product: CampaignEmailProduct) {
  const sale = product.showSalePrice === false ? "" : (product.salePrice ?? "").replace(/^from\s+/i, "");
  const compare = product.showCompareAtPrice === false ? "" : (product.compareAtPrice ?? "").replace(/^from\s+/i, "");
  const dollars = /^\$([\d,]+(?:\.\d{2})?)$/;
  const saleAmount = dollars.test(sale) ? Number(sale.replace(/[$,]/g, "")) : 0;
  const compareAmount = dollars.test(compare) ? Number(compare.replace(/[$,]/g, "")) : 0;
  const discount = compareAmount > saleAmount && saleAmount > 0
    ? Math.round(100 * (compareAmount - saleAmount) / compareAmount)
    : 0;
  return { sale, compare, discount };
}

function productImage(image: string, featured: boolean) {
  const url = new URL(image);
  if (url.hostname === "cdn.shopify.com") {
    const width = featured ? 704 : 340;
    url.searchParams.set("width", String(width));
    url.searchParams.set("height", String(featured ? 596 : width));
    if (!url.searchParams.has("crop")) url.searchParams.set("crop", "center");
  }
  return url.href;
}

function productCard(product: CampaignEmailProduct, featured: boolean) {
  const { sale, compare, discount } = productPrice(product);
  const width = featured ? 251 : 119;
  const imageHeight = featured ? 213 : width;
  const cardStyle = featured ? "width:50%;min-width:215px;" : "width:25%;min-width:112px;";
  const linkedPhoto = product.image ? `
    <a href="${escape(product.url)}" aria-label="${escape(product.title)}" style="display:block;text-decoration:none;">
      <img class="${featured ? "mbf-featured-img" : "mbf-grid-img"}" src="${escape(productImage(product.image, featured))}" alt="${escape(product.title)}" width="${width}" height="${imageHeight}" style="display:block;width:100%;height:auto;aspect-ratio:${featured ? "1.18" : "1"};object-fit:cover;border:0;color:${ink};background-color:#e2e6e8;font:12px/16px ${font};">
    </a>` : "";
  const titleStyle = featured ? "min-height:34px;font-size:16px;line-height:19px;" : "min-height:48px;font-size:12px;line-height:15px;";
  const discountStyle = featured ? "display:inline-block;" : "display:table;margin-top:2px;";
  return `<div class="${featured ? "mbf-featured" : "mbf-product"}" style="display:inline-block;${cardStyle}vertical-align:top;text-align:left;">
    <table ${presentation} width="100%" style="width:100%;table-layout:fixed;">
      <tr><td valign="top" style="padding:0 6px ${featured ? "0" : "14"}px;">
        ${linkedPhoto}
        <div class="mbf-title" style="padding:9px 1px 0;${titleStyle}font-family:${font};font-weight:700;color:${ink};overflow-wrap:anywhere;">
          <a href="${escape(product.url)}" style="color:${ink};text-decoration:none;">${escape(product.title)}</a>
          ${product.variantLabel ? `<span style="display:block;color:${muted};font:11px/13px ${font};">${escape(product.variantLabel)}</span>` : ""}
        </div>
        ${sale || compare ? `<div style="padding:5px 1px 0;color:${ink};font:11px/19px ${font};">
          <span style="display:inline-block;white-space:nowrap;">
            ${sale ? `<strong class="mbf-price" style="color:${saleBlue};font-size:${featured ? "16px" : "13px"};">${escape(sale)}</strong>` : ""}
            ${compare ? `<s class="mbf-compare" style="margin-left:4px;color:#586475;font-size:11px;">${escape(compare)}</s>` : ""}
          </span>
          ${discount ? `<span class="mbf-discount" style="${discountStyle}padding:2px 6px;background-color:${badge};color:${navy};font:700 11px/15px ${font};white-space:nowrap;vertical-align:baseline;">${discount}% OFF</span>` : ""}
        </div>` : ""}
      </td></tr>
    </table>
  </div>`;
}

function productRow(products: readonly CampaignEmailProduct[], featured: boolean) {
  const column = featured ? 263 : 132;
  return `<div style="margin:0 -6px;font-size:0;line-height:0;text-align:left;">
    <!--[if mso]><table ${presentation} width="526"><tr><![endif]-->
    ${products.map((product) =>
      `<!--[if mso]><td width="${column}" valign="top"><![endif]-->${productCard(product, featured)}<!--[if mso]></td><![endif]-->`,
    ).join("")}
    <!--[if mso]></tr></table><![endif]-->
  </div>`;
}

function productGrid(source: Content) {
  const featured = source.macroBlackFriday?.featuredProducts ?? [];
  const grid = source.macroBlackFriday?.gridProducts ?? [];
  return `
    ${featured.length ? `<tr><td class="mbf-light mbf-inset mbf-featured-group" bgcolor="${paper}" style="padding:23px 43px 19px;background-color:${paper};border-top:4px solid ${gold};">
      ${productRow(featured, true)}
    </td></tr>` : ""}
    ${grid.length ? `<tr><td class="mbf-light mbf-inset mbf-small-group" bgcolor="${paper}" style="padding:${featured.length ? "16" : "23"}px 43px 8px;background-color:${paper};${featured.length ? "" : `border-top:4px solid ${gold};`}">
      <div style="${featured.length ? `padding-top:16px;border-top:1px solid ${border};` : ""}">
        ${productRow(grid.slice(0, 4), false)}
        ${grid.length > 4 ? productRow(grid.slice(4), false) : ""}
      </div>
    </td></tr>` : ""}`;
}

function footer(options: EmailOptions) {
  const address = options.address
    ? `<div style="margin-top:9px;font-size:11px;line-height:16px;">${lineBreaks(escape(options.address))}</div>`
    : "";
  return `<tr><td class="mbf-dark mbf-inset" bgcolor="${navy}" style="padding:20px 43px 22px;border-top:3px solid ${gold};background-color:${navy};color:${gold};font:12px/20px ${font};">
    <strong style="font-size:13px;">${escape(options.organizationName || storeName)}</strong><br>
    <a href="${escape(storeUrl)}" style="color:${gold};text-decoration:underline;">Visit the store</a>&nbsp; &middot; &nbsp;<a href="${escape(options.unsubscribe)}" style="color:${gold};text-decoration:underline;">Unsubscribe</a>
    ${address}
  </td></tr>`;
}

export function renderMacroBlackFridayEmail(source: Content, options: EmailOptions) {
  const assets = options.assetBaseUrl.replace(/\/$/, "") + "/api/marketing/black-friday-assets/";
  const preheader = source.preview ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escape(source.preview)}</div>` : "";
  return `<!doctype html><html lang="en">${emailHead(assets + "macro-hero-mobile-v1.jpg")}
    <body bgcolor="${outer}" style="margin:0;padding:0;background-color:${outer};">
      ${preheader}
      <table ${presentation} width="100%" bgcolor="${outer}" style="width:100%;background-color:${outer};">
        <tr><td class="mbf-outer" align="center" style="padding:23px 0;">
          <!--[if mso]><table ${presentation} width="600"><tr><td><![endif]-->
          <table ${presentation} width="100%" align="center" bgcolor="${paper}" style="width:100%;max-width:600px;table-layout:fixed;background-color:${paper};">
            ${hero(assets, source.body)}
            ${productGrid(source)}
            <tr><td class="mbf-light mbf-inset" align="center" bgcolor="${paper}" style="padding:3px 43px 28px;background-color:${paper};">
              ${shopButton()}
            </td></tr>
            ${footer(options)}
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td></tr>
      </table>
    </body>
  </html>`;
}

export function macroBlackFridayPlainText(source: Content, unsubscribe: string, address: string, organizationName: string) {
  const products = [
    ...(source.macroBlackFriday?.featuredProducts ?? []),
    ...(source.macroBlackFriday?.gridProducts ?? []),
  ].map((product) => {
    const { sale, compare, discount } = productPrice(product);
    return [product.title, product.variantLabel, sale, compare ? "Was " + compare : "",
      discount ? `${discount}% OFF` : "", product.url].filter(Boolean).join(" · ");
  });
  return [
    headline,
    source.body,
    `${shopLabel}: ${MACRO_BLACK_FRIDAY_URL}`,
    ...products,
    `${shopLabel}: ${MACRO_BLACK_FRIDAY_URL}`,
    organizationName || storeName,
    `Visit the store: ${storeUrl}`,
    address,
    `Unsubscribe: ${unsubscribe}`,
  ].filter(Boolean).join("\n\n");
}
