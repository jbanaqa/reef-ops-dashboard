import layouts from "./macro-newsletter-layouts.json";
import { escapeHtml, imageSource, personalize, safeUrl, type CampaignEmailProduct, type Content } from "./rules";

export type MacroNewsletterDesign = "nitrate" | "habitat" | "field-guide";
export type NewsletterImage = { src: string; alt: string };
export type NewsletterProduct = CampaignEmailProduct & { portion: string; pricePrefix: string; alt: string };
export type MacroNewsletter = {
  design: MacroNewsletterDesign;
  /** Omitted newsletters inherit the brand footer; an explicit choice stays local. */
  showPostalAddress?: boolean;
  text: Record<string, string>;
  links: Record<string, string>;
  images: Record<string, NewsletterImage>;
  products: NewsletterProduct[];
};
export type NewsletterField = { key: string; type: "text" | "link" | "image"; group: string; label: string; multiline?: boolean };
type Definition = { design: MacroNewsletterDesign; name: string; subject: string; preview: string; heading: string; body: string; fields: NewsletterField[]; defaults: Omit<MacroNewsletter, "design">; html: string; css: string };
export const macroNewsletterDefinitions = layouts.templates as unknown as Definition[];

export function newsletterDefinition(design: unknown) {
  const found = macroNewsletterDefinitions.find(item => item.design === design);
  if (!found) throw new Error("Choose one of the three approved Macroalgae Farms newsletters.");
  return found;
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
  return { design: definition.design,
    ...(typeof input.showPostalAddress === "boolean" ? { showPostalAddress: input.showPostalAddress } : {}),
    text, links, images, products: input.products.slice(0, 40).map((product, index) => ({
    id: String(product.id || `newsletter-product-${index}`).slice(0, 100), title: String(product.title ?? "").slice(0, 200),
    url: newsletterLink(product.url), image: product.image ? imageSource(product.image) : undefined,
    alt: String(product.alt ?? "").slice(0, 300), portion: String(product.portion ?? "").slice(0, 200),
    pricePrefix: String(product.pricePrefix ?? "").slice(0, 80), salePrice: String(product.salePrice ?? "").slice(0, 80),
    button: String(product.button ?? "").slice(0, 80), showSalePrice: product.showSalePrice !== false, showButton: product.showButton !== false,
    showCompareAtPrice: false,
  })) };
}

function productsHtml(products: NewsletterProduct[]) {
  const e = escapeHtml;
  const rows: string[] = [];
  for (let index = 0; index < products.length; index += 2) {
    const cells = products.slice(index, index + 2).map((product, column) => {
      const link = (label: string, style = "") => product.url ? `<a href="${e(product.url)}" style="color:inherit;text-decoration:none;${style}">${label}</a>` : label;
      return `<td class="nl-product-cell" width="50%" valign="top" style="width:50%;padding:0 ${column ? 0 : 12}px 19px ${column ? 12 : 0}px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed"><tr><td width="76" valign="top" style="width:76px">${product.image ? link(`<img src="${e(product.image)}" alt="${e(product.alt)}" width="76" height="76" style="display:block;width:76px;height:76px;object-fit:cover">`) : ""}</td><td valign="top" style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;color:#102641"><h3 style="margin:0 0 4px;font-size:14px;font-weight:600;line-height:1.4">${link(e(product.title))}</h3><p style="margin:0 0 4px;color:#465c71;font-size:12px;line-height:1.4">${e(product.portion)}</p>${product.showSalePrice !== false ? `<p style="margin:0;font-size:13px;line-height:1.5;color:#465c71">${e(product.pricePrefix)}${product.pricePrefix ? " " : ""}<strong style="color:#102641;font-weight:600">${e(product.salePrice || "")}</strong></p>` : ""}${product.showButton !== false && product.button ? link(`<span>${e(product.button)}</span> <span aria-hidden="true">→</span>`, "display:inline-block;min-height:44px;line-height:44px;text-decoration:underline;text-underline-offset:4px;font-size:12px;color:#284b88") : ""}</td></tr></table></td>`;
    });
    if (cells.length === 1) cells.push('<td class="nl-product-cell" width="50%"></td>');
    rows.push(`<tr>${cells.join("")}</tr>`);
  }
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed">${rows.join("")}</table>`;
}

export function renderMacroNewsletter(c: Content, unsubscribe: string, address: string, name?: string) {
  const newsletter = c.macroNewsletter!;
  const definition = newsletterDefinition(newsletter.design);
  const text = (value: string) => escapeHtml(personalize(value, name)).replace(/\r?\n/g, "<br>");
  const template = definition.html.replace(/<img\b[^>]*src="\[\[NL:image:([\w-]+)\]\]"[^>]*>/g, (markup, key: string) => newsletter.images[key]?.src ? markup : "");
  const body = template.replace(/\[\[NL:(\w+):([\w-]+)\]\]/g, (_token, type: string, key: string) => {
    if (type === "text") return text(newsletter.text[key] || "");
    if (type === "link") return escapeHtml(newsletter.links[key] || "#");
    if (type === "image") return escapeHtml(newsletter.images[key]?.src || "");
    if (type === "alt") return escapeHtml(newsletter.images[key]?.alt || "");
    if (type === "products") return productsHtml(newsletter.products);
    if (type === "system") {
      if (key === "heading") return text(c.heading);
      if (key === "body") return text(c.body);
      if (key === "unsubscribe") return escapeHtml(unsubscribe);
      if (key === "unsubscribeLabel") return text(c.footerUnsubscribeLinkText ?? "Unsubscribe");
      if (key === "address") return c.showPostalAddress && address ? `<p style="margin:12px 0 0;font:12px/1.7 Arial,sans-serif;color:inherit">${text(address)}</p>` : "";
    }
    return "";
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0}table{border-spacing:0}img{max-width:100%}td,p,h1,h2,h3,a{overflow-wrap:anywhere}${definition.css}</style></head><body style="margin:0;background:#ffffff"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${text(c.preview || "")}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><!--[if mso]><table role="presentation" width="620"><tr><td><![endif]-->${body}<!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}

export function macroNewsletterText(c: Content, unsubscribe: string, address: string, name?: string) {
  const newsletter = c.macroNewsletter!;
  const definition = newsletterDefinition(newsletter.design);
  return [c.heading, c.body,
    ...definition.fields.filter(field => field.type === "text").map(field => newsletter.text[field.key]),
    ...Object.values(newsletter.links),
    ...newsletter.products.map(product => [product.title, product.portion, product.showSalePrice !== false ? [product.pricePrefix, product.salePrice].filter(Boolean).join(" ") : "", product.url].filter(Boolean).join(" · ")),
    c.showPostalAddress ? address : "", `${c.footerUnsubscribeLinkText ?? "Unsubscribe"}: ${unsubscribe}`,
  ].filter(Boolean).map(line => personalize(line, name)).join("\n\n");
}
