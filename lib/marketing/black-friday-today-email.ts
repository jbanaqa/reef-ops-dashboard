import { BLACK_FRIDAY_TODAY_DEADLINE, type BlackFridayDesign } from "./black-friday";
import { DAILY_DEALS_COUNTDOWN_PATH } from "./daily-deals-countdown-config";
import { escapeHtml as escape, type CampaignEmailProduct, type Content } from "./rules";

type Options = {
  assetBaseUrl: string;
  unsubscribe: string;
  address: string;
};

const table = 'role="presentation" width="100%" cellpadding="0" cellspacing="0"';

function productPrices(product: CampaignEmailProduct) {
  const price = product.showSalePrice === false ? "" : product.salePrice || "";
  const original = product.showCompareAtPrice === false ? "" : product.compareAtPrice || "";
  const usd = /^\$\d[\d,]*(?:\.\d{2})?$/;
  const amount = (value: string) => usd.test(value) ? Number(value.replace(/[$,]/g, "")) : 0;
  const saleAmount = amount(price.replace(/^from\s+/i, ""));
  const originalAmount = amount(original);
  const percentOff = saleAmount > 0 && originalAmount > saleAmount
    ? Math.round(100 * (originalAmount - saleAmount) / originalAmount)
    : 0;
  return { price, original, discount: percentOff ? percentOff + "% OFF" : "" };
}

function productPhoto(product: CampaignEmailProduct, daily: boolean, discount: string) {
  const url = escape(product.url);
  const title = escape(product.title);
  const style = daily ? "width:100%;height:156px;object-fit:cover;object-position:center;background-color:#4e214e;"
    : "width:100%;height:175px;object-fit:cover;object-position:center;background-color:#392145;";
  const photo = product.image ? `<img class="${daily ? "today-img" : "pick-image"}" src="${escape(product.image)}" width="${daily ? 180 : 275}" height="${daily ? 156 : 175}" alt="${title}" style="display:block;${style}color:#fff9ef;">` : "";
  const tagStyle = "background-color:#f8cf7b;background-image:linear-gradient(135deg,#ffe5a5,#efb455);border:1px solid #be8140;border-radius:3px;padding:4px 6px;color:#48213e;font-size:11px;font-weight:900;font-style:italic;line-height:14px;white-space:nowrap;";
  const badge = daily && discount ? `<!--[if !mso]><!--><span class="today-badge" style="position:absolute;top:7px;left:6px;display:inline-block;${tagStyle}">${discount}</span><!--<![endif]-->
    <!--[if mso]><span style="${tagStyle}">${discount}</span><![endif]-->` : "";
  return photo || badge ? `<a href="${url}" style="position:relative;display:block;color:#fff9ef;text-decoration:none;">${badge}${photo}</a>` : "";
}

function dailyGrid(products: readonly CampaignEmailProduct[]) {
  if (!products.length) return "";
  return `<table ${table} style="margin-top:8px;table-layout:fixed;"><tr>${products.map((product, index) => {
    const { price, original, discount } = productPrices(product);
    const spaceLeft = index === 0 ? 0 : 2.5;
    const spaceRight = index === products.length - 1 ? 0 : 2.5;
    const width = (100 / products.length).toFixed(2);
    return `<td width="${width}%" valign="top" style="width:${width}%;padding:0 ${spaceRight}px 0 ${spaceLeft}px;">
      <table class="today-card" ${table} bgcolor="#fff9ef" style="border-collapse:separate;border-spacing:0;background-color:#fff9ef;border:1px solid #e7ab9c;box-shadow:0 3px 0 #a8576335;">
        <tr><td>${productPhoto(product, true, discount)}</td></tr>
        <tr><td class="today-info" style="padding:9px 8px 10px;">
          <h3 class="today-name" style="margin:0 0 3px;min-height:40px;font-size:16px;line-height:20px;font-weight:800;color:#361735;"><a href="${escape(product.url)}" style="color:#361735;text-decoration:none;">${escape(product.title)}</a></h3>
          <p class="today-price" style="margin:0;color:#695061;font-size:11px;line-height:19px;"><strong style="font-size:19px;color:#467900;">${escape(price)}</strong>${original ? ` <s>${escape(original)}</s>` : ""}</p>
        </td></tr>
      </table>
    </td>`;
  }).join("")}</tr></table>`;
}

function pickCard(product: CampaignEmailProduct, side: "left" | "right") {
  const { price, original, discount } = productPrices(product);
  const discountBar = discount ? `<tr><td class="pick-flag" align="center" bgcolor="#f8cf7b" style="padding:5px 3px 4px;background-color:#f8cf7b;background-image:linear-gradient(90deg,#f6bb68,#ffe5a5);color:#48213e;font-size:16px;line-height:19px;font-style:italic;font-weight:900;letter-spacing:.85px;white-space:nowrap;">${discount}</td></tr>` : "";
  return `<td class="pick-${side}" width="50%" valign="top" style="width:50%;padding-${side === "left" ? "right" : "left"}:6px;">
    <table ${table} bgcolor="#fff8ee" style="border-collapse:separate;border-spacing:0;background-color:#fff8ee;border:1px solid #e6aba9;box-shadow:0 3px 0 #d1949570;">
      <tr><td>${productPhoto(product, false, discount)}</td></tr>
      ${discountBar}
      <tr><td class="pick-info" style="padding:12px 13px 13px;">
        <h3 class="pick-name" style="margin:0 0 5px;min-height:40px;color:#361936;font-size:17px;line-height:20px;font-weight:800;"><a href="${escape(product.url)}" style="text-decoration:none;color:#361936;">${escape(product.title)}</a></h3>
        <p style="margin:0 0 5px;color:#634253;font-size:12px;line-height:22px;"><strong style="color:#467900;font-size:21px;white-space:nowrap;">${escape(price)}</strong>${original ? ` &nbsp;<s style="white-space:nowrap;">${escape(original)}</s>` : ""}</p>
      </td></tr>
    </table>
  </td>`;
}

function picksGrid(products: readonly CampaignEmailProduct[]) {
  if (!products.length) return "";
  const rows: string[] = [];
  for (let index = 0; index < products.length; index += 2) {
    const left = pickCard(products[index], "left");
    const right = products[index + 1] ? pickCard(products[index + 1], "right") : '<td width="50%" aria-hidden="true"></td>';
    rows.push(`<tr>${left}${right}</tr>`);
  }
  return `<table ${table} style="table-layout:fixed;">${rows.join('<tr><td colspan="2" height="12" style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>')}</table>`;
}

export function renderBlackFridayTodayEmail(source: Content, design: BlackFridayDesign, options: Options) {
  const base = options.assetBaseUrl.replace(/\/$/, "");
  const assets = escape(base + "/api/marketing/black-friday-assets/");
  const timer = escape(base + DAILY_DEALS_COUNTDOWN_PATH + "?deadline=" + encodeURIComponent(BLACK_FRIDAY_TODAY_DEADLINE));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <meta name="x-apple-disable-message-reformatting">
  <title>Black Friday is today! 🪸</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    table { border-collapse: collapse; }
    table, td { mso-table-lspace: 0; mso-table-rspace: 0; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    img { display: block; border: 0; -ms-interpolation-mode: bicubic; }
    a { color: inherit; }
    @media screen and (max-width: 600px) {
      .exterior { padding: 0 !important; }
      .brand-row { padding: 10px 16px !important; }
      .stage { background-position: 50% 38% !important; }
      .hero-content { padding: 19px 15px 25px !important; }
      .offer-mark { width: min(328px, calc(100vw - 30px)) !important; }
      .hero-cta img { width: 245px !important; }
      .daily { padding: 0 14px 16px !important; }
      .picks { padding: 18px 14px 23px !important; }
      .pick-left { padding-right: 5px !important; }
      .pick-right { padding-left: 5px !important; }
      .pick-image { height: clamp(112px, 39vw, 183px) !important; }
      .pick-info { padding: 9px 8px 11px !important; }
      .pick-name {
        font-size: 15px !important; line-height: 17px !important; min-height: 51px !important;
        display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
      }
      .pick-flag { font-size: 9px !important; letter-spacing: .42px !important; }
      .footer-scene { padding: 23px 17px 27px !important; }
    }
    @media screen and (max-width: 360px) {
      .pick-name { font-size: 14px !important; min-height: 68px !important; -webkit-line-clamp: 4; }
      .pick-flag { letter-spacing: .1px !important; }
    }

    .pick-flag { font-size: 16px !important; line-height: 19px !important; font-style: italic; letter-spacing: .8px !important; }
    #closing-deal { background-color:#ffdf6c !important; background-image:linear-gradient(180deg,#fff0a1,#ffc748) !important; }
    @media screen and (max-width: 600px) {
      .brand-logo { width: 207px !important; }
      .brand-row { padding: 11px 15px !important; }
      .hero-content { padding-bottom: 51px !important; }
      .today-img { height: clamp(90px, 29vw, 148px) !important; }
      .today-badge { top: 5px !important; left: 4px !important; font-size: 10px !important; padding: 3px 5px !important; }
      .today-info { padding: 7px 5px 8px !important; }
      .today-name { font-size: 12px !important; line-height: 15px !important; min-height: 30px !important; }
      .today-price strong { font-size: 16px !important; }
      .today-price s { display: block; font-size: 10px; line-height: 12px; }
      .pick-flag { font-size: 14px !important; line-height: 17px !important; }
      .footer-scene { padding-top: 53px !important; }
    }
    @media screen and (max-width: 360px) {
      .today-name { font-size: 11px !important; line-height: 14px !important; min-height: 42px !important; }
    }
    @media screen and (max-width: 600px) {
      .caption-art { width: min(294px, calc(100vw - 44px)) !important; }
      .clock-content { padding: 11px 10px 9px !important; }
      .clock-title { font-size: 23px !important; line-height: 26px !important; }
      .clock-link, .clock-img { width: 240px !important; }
      .picks-divider-title { font-size: 17px !important; line-height: 21px !important; }
      .picks-divider-label { padding: 0 8px !important; }
    }
    @media screen and (max-width: 360px) {
      .picks-divider-title { font-size: 15px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#efe6f0;color:#280e35;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;font-size:1px;line-height:1px;mso-hide:all;">
    ${escape(source.preview || "")}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#efe6f0" style="background-color:#efe6f0;">
    <tr><td class="exterior" align="center" style="padding:20px 12px;">
      <!--[if mso]><table role="presentation" width="620" align="center"><tr><td><![endif]-->
      <table role="presentation" class="email" width="100%" cellpadding="0" cellspacing="0" bgcolor="#200d31" style="max-width:620px;background-color:#200d31;">
        <tr><td height="4" bgcolor="#ff8650" style="height:4px;line-height:4px;font-size:0;background-color:#ff8650;background-image:linear-gradient(90deg,#853cdb 5%,#fb428e 43%,#ff8c51 78%,#ffe46e);">&nbsp;</td></tr>
        <tr><td class="stage" background="${assets}today-sunset-reef-v1.jpg" bgcolor="#200d31" style="background-color:#200d31;background-image:linear-gradient(180deg,#1b0c2c18 0%,#2b0e4521 68%,#8e507a66 78%,#d48b89 91%,#ffead6 100%),url('${assets}today-sunset-reef-v1.jpg');background-position:center;background-size:cover;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td class="brand-row" align="center" style="padding:15px 20px;background-color:#1b0b2cce;border-bottom:1px solid #ff96ae3d;">
              <a href="https://coralsanonymous.com/" aria-label="Corals Anonymous home" style="display:inline-block;">
                <img class="brand-logo" src="${assets}today-corals-logo-v1.png" width="249" alt="Corals Anonymous" style="display:block;width:249px;max-width:100%;height:auto;color:#fff0d9;font-weight:900;">
              </a>
            </td></tr>
            <tr><td class="hero-content" align="center" style="padding:23px 28px 59px;">
              <h1 style="margin:0 0 10px;text-align:center;font-size:37px;line-height:1.05;color:#ffe7b6;font-style:italic;font-weight:900;">
                <img class="offer-mark" src="${assets}today-headline-v1.png" width="426" alt="Black Friday is today!" style="display:block;width:426px;max-width:100%;height:auto;margin:0 auto;color:#ffe5a4;font-size:37px;">
              </h1>
              <img class="caption-art" src="${assets}today-caption-v1.png" width="326" alt="Shop today while your picks are still available." style="display:block;width:326px;max-width:100%;height:auto;margin:0 auto 12px;color:#fff1d6;font-size:19px;font-style:italic;">
              <table role="presentation" class="hero-cta" cellpadding="0" cellspacing="0" align="center"><tr><td>
                <a href="${escape(source.url)}" style="display:block;color:#ffda78;font-size:15px;font-weight:800;line-height:24px;text-decoration:none;">
                  <img src="${assets}today-shop-button-v1.png" width="254" alt="Shop Today’s Picks" style="width:254px;max-width:100%;height:auto;color:#ffe28e;">
                </a>
              </td></tr></table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td class="daily" bgcolor="#ffead6" style="padding:0 25px 19px;background-color:#ffead6;background-image:linear-gradient(173deg,#ffead6 15%,#ffdfcd 100%);">
          <table class="clock-panel" role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#33173f" style="border-collapse:separate;border-spacing:0;background-color:#33173f;background-image:radial-gradient(ellipse at 50% -18%,#733351 0%,#462044 48%,#2c123d 94%);border:1px solid #cb8b82;border-top:2px solid #f8c481;">
            <tr>
              <td class="clock-content" align="center" style="padding:13px 12px 11px;">
                <h2 class="clock-title" style="margin:0 0 7px;color:#ffe3a0;font-size:26px;line-height:28px;font-weight:900;font-style:italic;letter-spacing:.25px;">LIMITED TIME ONLY!</h2>
                <a class="clock-link" href="${escape(source.url)}" aria-label="Shop today’s Black Friday deals" style="display:block;text-decoration:none;margin:0 auto;width:276px;max-width:100%;">
                  <img class="clock-img" src="${timer}" alt="Daily deals reset at midnight Pacific" width="276" style="display:block;width:276px;max-width:100%;height:auto;margin:0 auto;color:#ffe6a8;font-weight:bold;">
                </a>
              </td>
            </tr>
          </table>
          ${dailyGrid(design.dailyProducts)}
        </td></tr>
        <tr><td class="picks" bgcolor="#ffdfcf" style="padding:18px 25px 25px;background-color:#ffdfcf;background-image:linear-gradient(180deg,#ffdfcd 0%,#ffd9cf 68%,#ffded1 100%);">
          <table class="picks-divider" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 13px;">
            <tr>
              <td class="picks-rule" width="50%" valign="middle" aria-hidden="true">
                <div style="height:2px;font-size:0;line-height:2px;background-color:#ca6e77;background-image:linear-gradient(90deg,#eeb881,#aa416b);">&nbsp;</div>
              </td>
              <td class="picks-divider-label" align="center" style="padding:0 12px;white-space:nowrap;">
                <h2 class="picks-divider-title" style="margin:0;color:#481a48;font-size:22px;line-height:27px;font-weight:900;font-style:italic;letter-spacing:-.35px;">MORE BLACK FRIDAY PICKS</h2>
              </td>
              <td class="picks-rule" width="50%" valign="middle" aria-hidden="true">
                <div style="height:2px;font-size:0;line-height:2px;background-color:#ca6e77;background-image:linear-gradient(90deg,#aa416b,#eeb881);">&nbsp;</div>
              </td>
            </tr>
          </table>
          ${picksGrid(design.sections[0]?.products ?? [])}
        </td></tr>
        <tr><td class="footer-scene" align="center" background="${assets}today-sunset-reef-v1.jpg" bgcolor="#2a0d37" style="padding:63px 22px 29px;background-color:#2a0d37;background-image:linear-gradient(180deg,#ffded1 0%,#c5878d 17%,#743b66c2 31%,#230d35a6 51%,#230d35a8 100%),url('${assets}today-sunset-reef-v1.jpg');background-position:50% 87%;background-size:cover;">
          <p style="margin:0 0 11px;color:#fff3e7;font-size:20px;line-height:25px;font-weight:900;font-style:italic;">Pick your next reef favorite.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;"><tr>
            <td id="closing-deal" bgcolor="#ffdf6c" align="center" style="background-color:#ffdf6c;background-image:linear-gradient(180deg,#fff0a1,#ffc748);border:1px solid #d99b3e;border-radius:4px;">
              <a href="${escape(source.url)}" style="display:inline-block;padding:13px 16px;color:#3a1a37;font-size:13px;line-height:18px;font-weight:900;letter-spacing:.35px;text-decoration:none;">SHOP ALL BLACK FRIDAY DEALS&nbsp;&nbsp;→</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td align="center" bgcolor="#1d0b2a" style="padding:13px 15px 15px;background-color:#1d0b2a;color:#e4c7dd;font-size:11px;line-height:17px;">
          ${options.address ? `<p style="margin:0 0 3px;">${escape(options.address)}</p>` : ""}
          <p style="margin:0;"><a href="https://coralsanonymous.com/" style="color:#ffedee;">Corals Anonymous</a><span aria-hidden="true">&nbsp;&nbsp;·&nbsp;&nbsp;</span><a href="${escape(options.unsubscribe)}" style="color:#ffedee;">Unsubscribe</a></p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}
