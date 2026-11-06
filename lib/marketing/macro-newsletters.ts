import layouts from "./macro-newsletter-layouts.json";
import { escapeHtml, imageSource, personalize, safeUrl, type CampaignEmailProduct, type Content } from "./rules";
import { newsletterFormattedText, newsletterTextLinks, normalizeNewsletterRichText, type NewsletterRichText } from "./newsletter-rich-text";

export type MacroNewsletterDesign = "nitrate" | "habitat" | "field-guide";
export type NewsletterImage = { src: string; alt: string };
export type NewsletterProduct = CampaignEmailProduct & { portion: string; pricePrefix: string; alt: string; richText?: NewsletterRichText };
export type MacroNewsletter = {
  design: MacroNewsletterDesign;
  /** Omitted newsletters inherit the brand footer; an explicit choice stays local. */
  showPostalAddress?: boolean;
  richText?: NewsletterRichText;
  hiddenSections?: string[];
  featuredLayout?: "columns" | "stacked";
  text: Record<string, string>;
  links: Record<string, string>;
  images: Record<string, NewsletterImage>;
  products: NewsletterProduct[];
};
export type NewsletterField = { key: string; type: "text" | "link" | "image"; group: string; label: string; multiline?: boolean };
export type NewsletterSection = { id: string; label: string; parent?: string; fields: string[] };
type Definition = { design: MacroNewsletterDesign; name: string; subject: string; preview: string; heading: string; body: string; fields: NewsletterField[]; defaults: Omit<MacroNewsletter, "design">; html: string; stackedFeatureHtml?: string; css: string; sections: NewsletterSection[]; collapses: { id: string; columns: string[]; single: Record<string, string>; empty: string }[] };
export const macroNewsletterDefinitions = layouts.templates as unknown as Definition[];

export function newsletterDefinition(design: unknown) {
  const found = macroNewsletterDefinitions.find(item => item.design === design);
  if (!found) throw new Error("Choose one of the three approved Macroalgae Farms newsletters.");
  return found;
}

export function newsletterSectionRemoved(newsletter: MacroNewsletter, id: string): boolean {
  const section = newsletterDefinition(newsletter.design).sections.find(section => section.id === id);
  return !!section && (!!newsletter.hiddenSections?.includes(id) || !!section.parent && newsletterSectionRemoved(newsletter, section.parent));
}

export function newsletterFieldVisible(newsletter: MacroNewsletter, key: string): boolean {
  return !newsletterDefinition(newsletter.design).sections.some(section => section.fields.includes(key) && newsletterSectionRemoved(newsletter, section.id));
}

const sectionPattern = (id: string) => new RegExp(`<!--NL:section:${id}-->[\\s\\S]*?<!--/NL:section:${id}-->`, "g");

/** Remove the complete approved container, including its table rows and spacing. */
export function newsletterSectionHtml(newsletter: MacroNewsletter): string {
  const definition = newsletterDefinition(newsletter.design);
  let html = definition.html;
  if (newsletter.design === "nitrate" && newsletter.featuredLayout === "stacked" && definition.stackedFeatureHtml)
    html = html.replace(sectionPattern("feature"), () => definition.stackedFeatureHtml!);
  for (const collapse of definition.collapses) {
    if (newsletterSectionRemoved(newsletter, collapse.id)) continue;
    const columns = collapse.columns.filter(id => !newsletterSectionRemoved(newsletter, id));
    if (columns.length === 1) html = html.replace(sectionPattern(collapse.id), () => collapse.single[columns[0]]);
    if (!columns.length) html = html.replace(sectionPattern(collapse.id), () => collapse.empty);
  }
  for (const section of definition.sections) if (newsletterSectionRemoved(newsletter, section.id)) html = html.replace(sectionPattern(section.id), "");
  return html.replace(/<!--\/?NL:section:[\w-]+-->/g, "")
    .replace(/<tr>\s*<\/tr>/g, "")
    .replace(/<table\b[^>]*>\s*(?:<tbody>\s*<\/tbody>)?\s*<\/table>/g, "");
}

/** Newsletter destinations stay on the brand's website; artwork may use HTTPS CDNs. */
export function newsletterLink(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^mailto:[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@macroalgaefarms\.com$/i.test(text)) return text;
  const url = new URL(safeUrl(text));
  if (!["macroalgaefarms.com", "www.macroalgaefarms.com"].includes(url.hostname))
    throw new Error("Newsletter links must point to Macroalgae Farms.");
  return url.href;
}

export function macroNewsletterContent(design: MacroNewsletterDesign): Content {
  const definition = newsletterDefinition(design);
  const defaults = structuredClone(definition.defaults);
  for (const image of Object.values(defaults.images)) if (image.src === "[[LOGO]]") image.src = layouts.logo;
  return {
    template: "standard", layout: "macro-newsletter", heading: definition.heading, body: definition.body,
    preview: definition.preview, button: "Browse the store", url: "https://www.macroalgaefarms.com/collections/all",
    footerUnsubscribeLinkText: "Unsubscribe", showPostalAddress: false, showFooterSocial: false, showFooterCopyright: false,
    macroNewsletter: { design, ...defaults },
  };
}

/** Stable built-ins appear for existing stores; saved edits override the starter by key. */
export function macroNewsletterTemplates(resources: { key: string; kind: string }[] = []) {
  return macroNewsletterDefinitions.filter(definition => !resources.some(resource => resource.kind === "TEMPLATE" && resource.key === `macro-newsletter-${definition.design}`)).map(definition => ({
    id: `macro-newsletter-${definition.design}`, key: `macro-newsletter-${definition.design}`, kind: "TEMPLATE", enabled: false,
    name: `Macroalgae Farms · ${definition.name}`, subject: definition.subject,
    data: macroNewsletterContent(definition.design) as unknown as Record<string, unknown>,
  }));
}

export function normalizeMacroNewsletter(value: unknown): MacroNewsletter | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Newsletter content is required.");
  const input = value as Partial<MacroNewsletter>;
  const definition = newsletterDefinition(input.design);
  const text: Record<string, string> = {}, links: Record<string, string> = {}, images: Record<string, NewsletterImage> = {};
  for (const field of definition.fields) {
    if (field.type === "text") text[field.key] = String(input.text?.[field.key] ?? "").slice(0, 20000);
    if (field.type === "link") links[field.key] = newsletterLink(input.links?.[field.key]);
    if (field.type === "image") images[field.key] = {
      src: input.images?.[field.key]?.src ? imageSource(input.images[field.key].src)! : "",
      alt: String(input.images?.[field.key]?.alt ?? "").slice(0, 300),
    };
  }
  if (!Array.isArray(input.products)) throw new Error("Select the newsletter products manually.");
  const richText = normalizeNewsletterRichText(input.richText, ["heading", "body", ...definition.fields.filter(field => field.type === "text").map(field => field.key)]);
  return { design: definition.design,
    ...(richText ? { richText } : {}),
    ...(Array.isArray(input.hiddenSections) ? { hiddenSections: definition.sections.filter(section => input.hiddenSections!.includes(section.id)).map(section => section.id) } : {}),
    ...(definition.design === "nitrate" && ["columns", "stacked"].includes(input.featuredLayout || "") ? { featuredLayout: input.featuredLayout } : {}),
    ...(typeof input.showPostalAddress === "boolean" ? { showPostalAddress: input.showPostalAddress } : {}),
    text, links, images, products: input.products.slice(0, 40).map((product, index) => ({
    id: String(product.id || `newsletter-product-${index}`).slice(0, 100), title: String(product.title ?? "").slice(0, 200),
    url: newsletterLink(product.url), image: product.image ? imageSource(product.image) : undefined,
    alt: String(product.alt ?? "").slice(0, 300), portion: String(product.portion ?? "").slice(0, 200),
    pricePrefix: String(product.pricePrefix ?? "").slice(0, 80), salePrice: String(product.salePrice ?? "").slice(0, 80),
    button: String(product.button ?? "").slice(0, 80), showSalePrice: product.showSalePrice !== false, showButton: product.showButton !== false,
    showCompareAtPrice: false,
    ...(product.richText ? { richText: normalizeNewsletterRichText(product.richText, ["title", "portion", "pricePrefix", "salePrice", "button"]) } : {}),
  })) };
}

function productsHtml(products: NewsletterProduct[], name?: string) {
  const e = escapeHtml;
  const rows: string[] = [];
  for (let index = 0; index < products.length; index += 2) {
    const cells = products.slice(index, index + 2).map((product, column) => {
      const formatted = (key: string, plain: string) => newsletterFormattedText(plain, product.richText?.[key], name, false);
      const link = (label: string, style = "") => product.url ? `<a href="${e(product.url)}" style="color:inherit;text-decoration:none;${style}">${label}</a>` : label;
      // Hybrid columns wrap intrinsically when head styles/media queries are unavailable.
      return `${column ? '<!--[if mso]></td><td width="278" valign="top"><![endif]-->' : ""}<div class="nl-product-column" style="display:inline-block;vertical-align:top;width:100%;max-width:278px;box-sizing:border-box;font-size:14px;line-height:1.4;text-align:left"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed"><tr><td class="nl-product-padding" style="padding:0 ${column ? 0 : 12}px 19px ${column ? 12 : 0}px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed"><tr><td width="76" valign="top" style="width:76px">${product.image ? link(`<img src="${e(product.image)}" alt="${e(product.alt)}" width="76" height="76" style="display:block;width:76px;height:76px;object-fit:cover">`) : ""}</td><td valign="top" style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;color:#102641;overflow-wrap:anywhere;word-wrap:break-word"><h3 style="margin:0 0 4px;font-size:14px;font-weight:600;line-height:1.4">${link(formatted("title", product.title))}</h3><p style="margin:0 0 4px;color:#465c71;font-size:12px;line-height:1.4">${formatted("portion", product.portion)}</p>${product.showSalePrice !== false ? `<p style="margin:0;font-size:13px;line-height:1.5;color:#465c71">${formatted("pricePrefix", product.pricePrefix)}${product.pricePrefix ? " " : ""}<strong style="color:#102641;font-weight:600">${formatted("salePrice", product.salePrice || "")}</strong></p>` : ""}${product.showButton !== false && product.button ? link(`<span>${formatted("button", product.button)}</span> <span aria-hidden="true">→</span>`, "display:inline-block;min-height:44px;line-height:44px;text-decoration:underline;text-underline-offset:4px;font-size:12px;color:#284b88") : ""}</td></tr></table></td></tr></table></div>`;
    });
    const outlookFiller = cells.length === 1 ? '</td><td width="278" valign="top">' : "";
    rows.push(`<div class="nl-product-row" style="font-size:0;line-height:0;text-align:left"><!--[if mso]><table role="presentation" width="556" cellspacing="0" cellpadding="0" style="table-layout:fixed"><tr><td width="278" valign="top"><![endif]-->${cells.join("")}<!--[if mso]>${outlookFiller}</td></tr></table><![endif]--></div>`);
  }
  return `<div class="nl-product-grid" style="width:100%">${rows.join("")}</div>`;
}

export function renderMacroNewsletter(c: Content, unsubscribe: string, address: string, name?: string) {
  const newsletter = c.macroNewsletter!;
  const definition = newsletterDefinition(newsletter.design);
  const text = (value: string) => escapeHtml(personalize(value, name)).replace(/\r?\n/g, "<br>");
  const template = newsletterSectionHtml(newsletter).replace(/<img\b[^>]*src="\[\[NL:image:([\w-]+)\]\]"[^>]*>/g, (markup, key: string) => newsletter.images[key]?.src ? markup : "");
  const body = template.replace(/\[\[NL:(\w+):([\w-]+)\]\]/g, (_token, type: string, key: string) => {
    if (type === "text") return newsletterFormattedText(newsletter.text[key] || "", newsletter.richText?.[key], name, definition.fields.find(field => field.key === key)?.multiline === true);
    if (type === "link") return escapeHtml(newsletter.links[key] || "#");
    if (type === "image") return escapeHtml(newsletter.images[key]?.src || "");
    if (type === "alt") return escapeHtml(newsletter.images[key]?.alt || "");
    if (type === "products") return productsHtml(newsletter.products, name);
    if (type === "system") {
      if (key === "heading") return newsletterFormattedText(c.heading, newsletter.richText?.heading, name);
      if (key === "body") return newsletterFormattedText(c.body, newsletter.richText?.body, name);
      if (key === "unsubscribe") return escapeHtml(unsubscribe);
      if (key === "unsubscribeLabel") return text(c.footerUnsubscribeLinkText ?? "Unsubscribe");
      if (key === "address") return c.showPostalAddress && address ? `<p style="margin:12px 0 0;font:12px/1.7 Arial,sans-serif;color:inherit">${text(address)}</p>` : "";
    }
    return "";
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;padding:0}table{border-spacing:0}img{max-width:100%}td,p,h1,h2,h3,a{overflow-wrap:anywhere}@media only screen and (max-width:520px){.nl-product-column{display:block!important;width:100%!important;max-width:100%!important}.nl-product-padding{padding-left:0!important;padding-right:0!important}}</style><style>${definition.css}</style></head><body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${text(c.preview || "")}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><!--[if mso]><table role="presentation" width="620"><tr><td><![endif]-->${body}<!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}

export function macroNewsletterText(c: Content, unsubscribe: string, address: string, name?: string) {
  const newsletter = c.macroNewsletter!;
  const definition = newsletterDefinition(newsletter.design);
  return [newsletterFieldVisible(newsletter, "heading") ? c.heading : "", newsletterFieldVisible(newsletter, "body") ? c.body : "",
    ...definition.fields.filter(field => field.type === "text" && newsletterFieldVisible(newsletter, field.key)).map(field => newsletter.text[field.key]),
    ...Object.entries(newsletter.links).filter(([key]) => newsletterFieldVisible(newsletter, key)).map(([, value]) => value),
    ...new Set(Object.entries(newsletter.richText || {}).filter(([key]) => newsletterFieldVisible(newsletter, key)).flatMap(([, value]) => newsletterTextLinks(value))),
    ...(newsletterSectionRemoved(newsletter, "products") ? [] : newsletter.products.map(product => [product.title, product.portion, product.showSalePrice !== false ? [product.pricePrefix, product.salePrice].filter(Boolean).join(" ") : "", product.url].filter(Boolean).join(" · "))),
    c.showPostalAddress ? address : "", `${c.footerUnsubscribeLinkText ?? "Unsubscribe"}: ${unsubscribe}`,
  ].filter(Boolean).map(line => personalize(line, name)).join("\n\n");
}
