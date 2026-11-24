import { blackFridaySalePrice } from "./black-friday";
import type { CampaignEmailProduct, Content } from "./rules";

export type BlackFridayCollection = {
  title: string;
  subtitle?: string;
  label?: string;
  url?: string;
  products: CampaignEmailProduct[];
};

type BlackFridayEmailOptions = {
  assetBaseUrl: string;
  timerUrl: string;
  dailyDealsUrl?: string;
  unsubscribe: string;
  address: string;
  organizationName: string;
  profileName?: string;
};

const cream = "#fff6e9";
const plum = "#36113e";
const peach = "#ffd8c6";
const gold = "#ffe04b";
const buttonFill = `background-color:${gold};background-image:linear-gradient(#fff079,${gold});`;
const font = "Barlow,Arial,Helvetica,sans-serif";
const assetPath = "/api/marketing/black-friday-assets/";
const table = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';

const htmlEntities: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
const escape = (value: string) => value.replace(/[&<>"']/g, char => htmlEntities[char]);

function emailHead(baseUrl: string) {
  const fontWeights = [["normal", 400], ["normal", 600], ["normal", 700], ["normal", 800], ["italic", 800], ["italic", 900]];
  const faces = fontWeights.map(([style, weight]) =>
    `@font-face{font-family:Barlow;font-style:${style};font-weight:${weight};font-display:swap;src:url("${escape(baseUrl + assetPath)}barlow-${style}-${weight}-v1.woff2") format("woff2")}`,
  ).join("");
  return `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><style>
    ${faces}
    table {border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt} img {border:0}
    @media only screen and (max-width:610px) {
      .bf-daily-outer {padding-left:12px!important;padding-right:12px!important}
      .bf-daily-pad {padding:15px 8px 14px!important}
      .bf-daily-title {font-size:30px!important}
      .bf-daily-copy {font-size:14px!important}
      .bf-daily-gutter {width:4px!important}
      .bf-daily-image {height:clamp(75px,22vw,133px)!important}
      .bf-daily-info {padding-left:5px!important;padding-right:5px!important}
      .bf-daily-title-cell {padding-top:7px!important}
      .bf-daily-button-cell {padding-bottom:8px!important}
      .bf-daily-name {font-size:13px!important;min-height:30px!important}
      .bf-daily-price {font-size:17px!important}
      .bf-daily-button {font-size:11px!important;padding:7px 2px!important}
      .bf-deal-badge {font-size:9px!important;padding:4px 5px!important;left:4px!important;top:4px!important}
      .bf-collection-outer {padding-left:16px!important;padding-right:16px!important;padding-top:34px!important}
      .bf-collection-heading {font-size:28px!important;letter-spacing:0!important;padding-left:8px!important;padding-right:8px!important}
      .bf-collection-rule {width:10%!important}
      .bf-collection-photo {height:150px!important}
    }
    @media only screen and (max-width:440px) {
      .bf-daily-prices s {display:block!important;margin:3px 0 0!important}
    }
    @media only screen and (max-width:559px) {
      .bf-collection-item {width:100%!important;min-width:0!important;max-width:100%!important;padding-right:0!important;padding-left:0!important;padding-bottom:15px!important}
    }
    @media only screen and (max-width:380px) {
      .bf-collection-heading {font-size:23px!important}
    }
  </style>
  <!--[if mso]><style>body,table,td,a,h2 {font-family:Arial,Helvetica,sans-serif!important}.bf-collection-item {width:100%!important}</style><![endif]--></head>`;
}

function linkedArtwork(url: string, image: string, alt: string, height: number) {
  return `<tr><td bgcolor="${peach}" style="background:${peach};font-size:0;line-height:0;"><a href="${escape(url)}" style="display:block;border:0;"><img src="${escape(image)}" alt="${escape(alt)}" width="800" height="${height}" style="display:block;width:100%;max-width:800px;height:auto;border:0;color:${plum};background:${peach};font:bold 21px/1.25 ${font};"></a></td></tr>`;
}

function priceValues(product: CampaignEmailProduct) {
  const price = blackFridaySalePrice(product);
  const compare = product.showCompareAtPrice === false ? "" : product.compareAtPrice ?? "";
  return { price, compare };
}

function discountPercent(product: CampaignEmailProduct) {
  const { price, compare } = priceValues(product);
  const usd = /^\$([\d,]+(?:\.\d{2})?)$/;
  if (!usd.test(price) || !usd.test(compare)) return 0;
  const parse = (value: string) => Number(value.replace(/[$,]/g, ""));
  const saleAmount = parse(price);
  const originalAmount = parse(compare);
  if (saleAmount <= 0 || originalAmount <= saleAmount) return 0;
  return Math.floor((1 - saleAmount / originalAmount) * 100 + 1e-8);
}

function priceMarkup(product: CampaignEmailProduct, daily: boolean) {
  const { price, compare } = priceValues(product);
  const amount = price ? `<strong class="${daily ? "bf-daily-price" : ""}" style="font-size:25px;font-size:clamp(17px,4vw,25px);color:#42651a;font-weight:800;letter-spacing:-.45px;">${escape(price)}</strong>` : "";
  const currentPrice = daily && amount
    ? `<span style="display:inline-block;white-space:nowrap;">${amount}</span>`
    : amount;
  return `<p class="${daily ? "bf-daily-prices" : ""}" style="margin:0 0 9px;line-height:1.1;font-family:${font};">
    ${currentPrice}
    ${compare ? ` <s style="display:inline-block;margin-left:5px;font-size:12px;font-weight:600;color:#817779;white-space:nowrap;">${escape(compare)}</s>` : ""}
  </p>`;
}

function productName(product: CampaignEmailProduct, daily: boolean) {
  return `<p class="${daily ? "bf-daily-name" : ""}" style="margin:0 0 ${daily ? "9" : "33"}px;min-height:${daily ? "38" : "40"}px;font-family:${font};line-height:1.12;font-size:${daily ? 17 : 18}px;font-weight:700;color:${plum};letter-spacing:-.25px;"><a href="${escape(product.url)}" style="color:${plum};text-decoration:none;">${escape(product.title)}</a></p>`;
}

function productButton(product: CampaignEmailProduct, daily: boolean) {
  if (product.showButton === false) return "";
  const url = escape(product.url);
  const label = escape(product.button || "View deal");
  return `<a class="${daily ? "bf-daily-button" : ""}" href="${url}" style="display:block;${buttonFill}border-bottom:2px solid #edc248;border-radius:7px;padding:7px 4px;color:${plum};text-decoration:none;text-align:center;font-family:${font};font-weight:800;font-size:${daily ? 14 : 13}px;font-style:italic;line-height:1;text-transform:uppercase;">${label} &nbsp;&#8594;</a>`;
}

function productPhoto(product: CampaignEmailProduct, daily: boolean) {
  if (!product.image) return "";
  const discount = daily ? discountPercent(product) : 0;
  const badge = discount ? `<span class="bf-deal-badge" style="position:absolute;left:7px;top:7px;padding:5px 8px;background:#ffe24b;color:${plum};font-family:${font};font-size:12px;font-weight:800;font-style:italic;line-height:1;white-space:nowrap;border-radius:4px;">${discount}% OFF</span>` : "";
  const imageClass = daily ? "bf-daily-image" : "bf-collection-photo";
  const height = daily ? 150 : 174;
  const width = daily ? 216 : 140;
  return `<a href="${escape(product.url)}" style="position:relative;display:block;text-decoration:none;color:${plum};">${badge}<img class="${imageClass}" src="${escape(product.image)}" alt="${escape(product.title)}" width="${width}" height="${height}" style="display:block;width:100%;height:${height}px;${daily ? "height:clamp(75px,18.75vw,150px);" : ""}object-fit:cover;object-position:center;border:0;border-radius:${daily ? "13px 13px 0 0" : "13px 0 0 13px"};background:#e7dcd8;"></a>`;
}

function dailyCards(products: readonly CampaignEmailProduct[]) {
  const visible = products.slice(0, 3);
  if (!visible.length) return "";
  const withPhotos = visible.some(product => product.image);
  const gutter = '<td class="bf-daily-gutter" width="1.5%" aria-hidden="true" style="width:1.5%;font-size:0;line-height:0;"></td>';
  const cardWidth = (100 - 1.5 * (visible.length - 1)) / visible.length;
  const panel = `background-color:${cream};border-left:1px solid #fff5ea;border-right:1px solid #fff5ea;text-align:left;overflow-wrap:anywhere;`;
  const top = "border-top:1px solid #fff5ea;border-radius:14px 14px 0 0;";
  const bottom = "border-bottom:1px solid #fff5ea;border-radius:0 0 14px 14px;";
  // Share row heights so wrapping titles or compare-at prices cannot shift
  // individual buttons, even when an inbox removes the responsive styles.
  const row = (className: string, style: string, part: (product: CampaignEmailProduct) => string) =>
    `<tr>${visible.map(product => `<td class="${className}" width="${cardWidth}%" bgcolor="${cream}" valign="top" style="${panel}${style}">${part(product)}</td>`).join(gutter)}</tr>`;
  return `<table ${table} style="table-layout:fixed;">
    ${withPhotos ? row("bf-daily-photo-cell", top, product => productPhoto(product, true)) : ""}
    ${row("bf-daily-info bf-daily-title-cell", `padding:11px 11px 0;${withPhotos ? "" : top}`, product => productName(product, true))}
    ${row("bf-daily-info", "padding:0 11px;", product => priceMarkup(product, true))}
    ${row("bf-daily-info bf-daily-button-cell", `padding:0 11px 12px;${bottom}`, product => productButton(product, true))}
  </table>`;
}

function dailyBlock(products: readonly CampaignEmailProduct[], options: BlackFridayEmailOptions) {
  const timerAlt = "Daily deals reset at midnight Pacific";
  const timer = `<img src="${escape(options.timerUrl)}" alt="${timerAlt}" width="320" height="64" style="display:block;margin:0 auto;width:320px;max-width:100%;height:auto;border:0;color:#ffe650;font:bold 15px/1.4 ${font};">`;
  return `<tr><td class="bf-daily-outer" style="padding:0 5%;">
    <table ${table} bgcolor="#421447" style="background-color:#421447;background-image:radial-gradient(ellipse at 50% 0%,#662266,transparent 68%),linear-gradient(145deg,#3c124e,#4b124e 65%,#411145);border:2px solid #ffedc5;border-radius:27px;box-shadow:0 10px 24px #5d2b451a;">
      <tr><td class="bf-daily-pad" align="center" style="padding:20px 3% 21px;color:#fff4dd;font-family:${font};">
        <h2 class="bf-daily-title" style="margin:0;font-size:42px;line-height:1.12;font-weight:900;font-style:italic;letter-spacing:.2px;color:#fff4dd;">DAILY SUPER DEALS</h2>
        <p class="bf-daily-copy" style="margin:4px 0 11px;color:#f7daec;font-size:17px;line-height:1.3;font-weight:600;">Deals refresh at midnight Pacific.</p>
        <div style="color:#f6d8ed;font-size:11px;font-weight:700;letter-spacing:2px;margin:0 0 5px;">DAILY DEALS RESET IN</div>
        <div style="margin:0 auto 13px;line-height:0;">${options.dailyDealsUrl ? `<a href="${escape(options.dailyDealsUrl)}" aria-label="See current daily deals" style="display:inline-block;max-width:100%;color:#ffe650;">${timer}</a>` : timer}</div>
        ${dailyCards(products)}
      </td></tr>
    </table>
  </td></tr>`;
}

function collectionCard(product: CampaignEmailProduct) {
  const photo = product.image ? `<td width="40%" valign="top" bgcolor="#e7dcd8" style="width:40%;border-radius:13px 0 0 13px;">${productPhoto(product, false)}</td>` : "";
  return `<table ${table} bgcolor="${cream}" style="table-layout:fixed;background-color:${cream};background-image:linear-gradient(140deg,#fffaf0,#fff3e7);border:1px solid #fff5ea;border-radius:14px;box-shadow:0 4px 0 #7437440d,0 4px 11px #6333430d;"><tr>
    ${photo}<td valign="top" ${photo ? 'width="60%" style="width:60%;"' : ""}><div style="padding:13px 11px 11px;text-align:left;overflow-wrap:anywhere;">${productName(product, false)}${priceMarkup(product, false)}${productButton(product, false)}</div></td>
  </tr></table>`;
}

function collectionCards(products: readonly CampaignEmailProduct[]) {
  if (!products.length) return "";
  // Fit two cards in narrower desktop email panes and wrap when only one
  // readable column fits, including clients that discard the media rules.
  const cells = products.map((product, index) => {
    const start = index % 2 === 0;
    const last = index === products.length - 1;
    return `${start ? "<!--[if mso]><tr><![endif]-->" : ""}<!--[if mso]><td width="372" valign="top"><![endif]-->
      <div class="bf-collection-item" style="display:inline-block;width:50%;min-width:260px;min-width:min(260px,100%);max-width:372px;vertical-align:top;box-sizing:border-box;padding:0 12px ${index < products.length - (products.length % 2 || 2) ? 30 : 0}px;text-align:left;line-height:normal;font-family:${font};">${collectionCard(product)}</div>
      <!--[if mso]></td>${last && start ? '<td width="372"></td>' : ""}${!start || last ? "</tr>" : ""}<![endif]-->`;
  });
  return `<div style="font-size:0;line-height:0;text-align:left;"><!--[if mso]><table role="presentation" width="744" cellpadding="0" cellspacing="0"><![endif]-->${cells.join("")}<!--[if mso]></table><![endif]--></div>`;
}

function collectionBlock(section: BlackFridayCollection) {
  const headingSize = section.title.length >= 20 ? 36 : 42;
  const titleWidth = (section.title.length * headingSize * 0.63 + 36) / 720 * 100;
  const ruleWidth = Math.max(7, Math.floor((100 - titleWidth) / 2));
  const rule = `<td class="bf-collection-rule" valign="middle" width="${ruleWidth}%" style="width:${ruleWidth}%;"><div style="height:2px;background-color:#e78a73;background-image:linear-gradient(90deg,#f2c4b4,#e78a73);font-size:0;line-height:0;">&nbsp;</div></td>`;
  const heading = `<table ${table} style="table-layout:fixed;"><tr>${rule}<td class="bf-collection-heading" align="center" style="overflow-wrap:anywhere;text-wrap:balance;color:${plum};padding:0 2.3%;font-family:${font};font-size:${headingSize}px;font-size:clamp(16px,5.25vw,${headingSize}px);line-height:1.1;font-weight:900;font-style:italic;text-transform:uppercase;letter-spacing:.3px;"><h2 style="font:inherit;color:inherit;margin:0;">${escape(section.title)}</h2></td>${rule}</tr></table>`;
  const link = section.label && section.url
    ? `<div align="center" style="padding:22px 0 0;"><a href="${escape(section.url)}" style="display:inline-block;color:${plum};font-weight:700;font-size:14px;line-height:1.45;font-family:${font};letter-spacing:.3px;text-transform:uppercase;text-decoration:none;border-bottom:1px solid #4e234d;padding-bottom:2px;">${escape(section.label)} &nbsp;&#8594;</a></div>`
    : "";
  return `<tr><td class="bf-collection-outer" style="padding:49px 28px 0;">
    <div style="margin:0 12px ${section.subtitle ? 12 : 23}px;">${heading}</div>
    ${section.subtitle ? `<div align="center" style="margin:0 12px 24px;color:#74496a;font:16px/1.25 ${font};">${escape(section.subtitle)}</div>` : ""}
    ${collectionCards(section.products)}
    ${link}
  </td></tr>`;
}

function footer(c: Content, options: BlackFridayEmailOptions) {
  return `<tr><td align="center" bgcolor="#421147" style="padding:26px 20px 24px;text-align:center;background-color:#421147;background-image:linear-gradient(135deg,#441348,#39103f);color:#f8e3ec;font-family:${font};">
    <strong style="display:block;font-size:17px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">${escape(options.organizationName)}</strong>
    <p style="margin:12px 0 0;font-size:13px;line-height:1.4;">
      <a href="https://coralsanonymous.com" style="color:#f6e5ed;text-decoration:underline;">Visit our reef</a>
      <span style="color:#aa75a4;padding:0 14px;">&middot;</span>
      <a href="${escape(options.unsubscribe)}" style="color:#f6e5ed;text-decoration:underline;">${escape(c.footerUnsubscribeLinkText || "Unsubscribe")}</a>
    </p>
    ${options.address ? `<div style="font-size:11px;line-height:1.45;margin:12px 0 0;color:#f8e3ec;">${escape(options.address).replace(/\r?\n/g, "<br>")}</div>` : ""}
  </td></tr>`;
}

/** The approved artwork is fixed; the cards, section headings and links are live email markup. */
export function renderBlackFridayEmail(
  c: Content,
  sections: readonly BlackFridayCollection[],
  dailyProducts: readonly CampaignEmailProduct[],
  options: BlackFridayEmailOptions,
) {
  const baseUrl = options.assetBaseUrl.replace(/\/$/, "");
  const assets = baseUrl + assetPath;
  const heroAlt = "Corals Anonymous Black Friday Sale. Up to 85% off on select items. Big savings on corals, anemones, and more! Shop all deals.";
  const gradient = "radial-gradient(ellipse at 49% 16%,rgba(255,248,225,.62),transparent 68%),linear-gradient(#ffd8c6 0%,#fbd5cf 38%,#fad0d6 71%,#ffd8c6 100%)";
  return `<!doctype html><html lang="en">${emailHead(baseUrl)}<body style="margin:0;padding:0;background:#23102e;font-family:${font};color:${plum};">
    <table ${table} bgcolor="#23102e"><tr><td align="center">
      <!--[if mso]><table role="presentation" width="800" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table ${table} bgcolor="${peach}" align="center" style="width:100%;max-width:800px;table-layout:fixed;background-color:${peach};">
        <tr><td style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escape(c.preview || "")}</td></tr>
        ${linkedArtwork(c.url, assets + "hero-v1.jpg", heroAlt, 590)}
        <tr><td bgcolor="${peach}" style="background-color:${peach};background-image:${gradient};">
          <table ${table} style="table-layout:fixed;">
            <tr><td align="center" style="padding:0 14px 10px;text-align:center;font:11px/1.4 ${font};color:#753956;">*On select items.</td></tr>
            ${dailyBlock(dailyProducts, options)}
            ${sections.map(collectionBlock).join("")}
          </table>
        </td></tr>
        ${linkedArtwork(c.url, assets + "closing-v1.jpg", "Shop all deals", 164)}
        ${footer(c, options)}
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr></table>
  </body></html>`;
}
