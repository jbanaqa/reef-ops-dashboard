import { escapeHtml, personalize } from "./rules";

export type NewsletterTextNode = {
  type: string;
  text?: string;
  attrs?: Record<string, string | number>;
  marks?: { type: string; attrs?: Record<string, string | number> }[];
  content?: NewsletterTextNode[];
};
export type NewsletterRichText = Record<string, NewsletterTextNode>;
export const newsletterFonts = ["Arial", "Verdana", "Georgia", "Trebuchet MS"];

export function richNewsletterLink(value: string) {
  if (/^mailto:[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@macroalgaefarms\.com$/i.test(value)) return value;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !["macroalgaefarms.com", "www.macroalgaefarms.com"].includes(url.hostname))
    throw Error("Use a link to Macroalgae Farms, such as its species library or a product page.");
  return url.href;
}

/** Only document structure and the formatting controls we expose can reach email HTML. */
export function normalizeNewsletterText(value: unknown): NewsletterTextNode {
  let count = 0, length = 0;
  const visit = (raw: unknown, depth: number): NewsletterTextNode => {
    if (++count > 1500 || depth > 12) throw Error("This text section is too complex. Paste a shorter passage.");
    if (!raw || typeof raw !== "object") throw Error("Invalid formatted text.");
    const node = raw as NewsletterTextNode;
    if (!["doc", "paragraph", "text", "hardBreak", "bulletList", "orderedList", "listItem"].includes(node.type)) throw Error("Unsupported newsletter text formatting.");
    if (node.type === "text") {
      const text = String(node.text ?? "");
      length += text.length;
      if (length > 20000) throw Error("Keep each text section under 20,000 characters.");
      const marks = (Array.isArray(node.marks) ? node.marks : []).slice(0, 12).flatMap(mark => {
        if (["bold", "italic", "underline", "strike"].includes(mark.type)) return [{ type: mark.type }];
        if (mark.type === "link") return [{ type: "link", attrs: { href: richNewsletterLink(String(mark.attrs?.href || "")) } }];
        if (mark.type !== "textStyle") return [];
        const attrs: Record<string, string | number> = {};
        for (const key of ["color", "backgroundColor"]) if (/^#[a-f0-9]{6}$/i.test(String(mark.attrs?.[key]))) attrs[key] = String(mark.attrs![key]);
        if (newsletterFonts.includes(String(mark.attrs?.fontFamily))) attrs.fontFamily = String(mark.attrs!.fontFamily);
        const size = String(mark.attrs?.fontSize || "");
        if (/^\d{1,2}px$/.test(size) && parseInt(size) >= 10 && parseInt(size) <= 48) attrs.fontSize = size;
        const lineHeight = Number(mark.attrs?.lineHeight);
        if (lineHeight >= 1 && lineHeight <= 2.5) attrs.lineHeight = String(lineHeight);
        return Object.keys(attrs).length ? [{ type: "textStyle", attrs }] : [];
      });
      return { type: "text", text, ...(marks.length ? { marks } : {}) };
    }
    if (node.type === "hardBreak") return { type: "hardBreak" };
    const attrs: Record<string, string | number> = {};
    if (node.type === "paragraph") {
      if (["left", "center", "right", "justify"].includes(String(node.attrs?.textAlign))) attrs.textAlign = String(node.attrs!.textAlign);
      const indent = Number(node.attrs?.indent);
      if (Number.isInteger(indent) && indent > 0) attrs.indent = Math.min(indent, 4);
    }
    if (node.type === "orderedList") attrs.start = Math.min(999, Math.max(1, Math.floor(Number(node.attrs?.start) || 1)));
    const children = (Array.isArray(node.content) ? node.content : []).map(child => visit(child, depth + 1));
    const allowed = node.type === "doc" ? ["paragraph", "bulletList", "orderedList"] : node.type === "paragraph" ? ["text", "hardBreak"] : node.type === "listItem" ? ["paragraph", "bulletList", "orderedList"] : ["listItem"];
    if (children.some(child => !allowed.includes(child.type))) throw Error("Invalid newsletter text structure.");
    return { type: node.type, ...(Object.keys(attrs).length ? { attrs } : {}), ...(children.length ? { content: children } : {}) };
  };
  const doc = visit(value, 0);
  if (doc.type !== "doc") throw Error("A text document is required.");
  return doc;
}

export function newsletterTextDocument(text: string): NewsletterTextNode {
  return { type: "doc", content: text.split(/\r?\n/).map(line => ({ type: "paragraph", ...(line ? { content: [{ type: "text", text: line }] } : {}) })) };
}
export function newsletterPlainText(node: NewsletterTextNode): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  return (node.content || []).map(newsletterPlainText).join(node.type === "paragraph" ? "" : "\n");
}

export function newsletterTextLinks(doc: NewsletterTextNode): string[] {
  return [...(doc.marks || []).filter(mark => mark.type === "link").map(mark => String(mark.attrs?.href || "")), ...(doc.content || []).flatMap(newsletterTextLinks)];
}

export function normalizeNewsletterRichText(value: unknown, keys: string[]): NewsletterRichText | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result: NewsletterRichText = {};
  for (const key of keys) {
    const raw = (value as Record<string, unknown>)[key];
    if (raw !== undefined) result[key] = normalizeNewsletterText(raw);
  }
  return Object.keys(result).length ? result : undefined;
}

/** Block spans keep formatted paragraphs valid inside the approved h1/p/a wrappers. */
export function newsletterFormattedText(plain: string, doc?: NewsletterTextNode, name?: string, allowLinks = true): string {
  const e = (text: string) => escapeHtml(personalize(text, name));
  if (!doc || newsletterPlainText(doc) !== plain) return e(plain).replace(/\r?\n/g, "<br>");
  const render = (node: NewsletterTextNode, index = 0): string => {
    if (node.type === "hardBreak") return "<br>";
    if (node.type === "text") return (node.marks || []).reduce((html, mark) => {
      const tags: Record<string, string> = { bold: "strong", italic: "em", underline: "u", strike: "s" };
      if (tags[mark.type]) return `<${tags[mark.type]}>${html}</${tags[mark.type]}>`;
      if (mark.type === "link") return allowLinks ? `<a href="${escapeHtml(String(mark.attrs?.href))}" style="color:inherit;text-decoration:underline">${html}</a>` : html;
      const styles = Object.entries(mark.attrs || {}).map(([key, value]) => `${key.replace(/[A-Z]/g, char => "-" + char.toLowerCase())}:${value}`).join(";");
      return styles ? `<span style="${escapeHtml(styles)}">${html}</span>` : html;
    }, e(node.text || ""));
    const children = (node.content || []).map(render).join("");
    if (node.type === "doc") return children;
    if (node.type === "paragraph") {
      if (doc.content?.length === 1 && doc.content[0] === node && !node.attrs?.textAlign && !node.attrs?.indent) return children || "<br>";
      const styles = ["display:block", "min-height:1em", ...(index ? ["margin-top:0.65em"] : []), ...(node.attrs?.textAlign ? [`text-align:${node.attrs.textAlign}`] : []), ...(node.attrs?.indent ? [`margin-left:${Number(node.attrs.indent) * 20}px`] : [])];
      return `<span style="${styles.join(";")}">${children || "<br>"}</span>`;
    }
    if (node.type === "listItem") return `<span role="listitem" style="display:block">${children}</span>`;
    return `<span role="list" style="display:block;margin:0.5em 0;padding-left:20px">${(node.content || []).map((child, number) => `<span role="listitem" style="display:block"><span style="float:left;margin-left:-16px">${node.type === "orderedList" ? Number(node.attrs?.start || 1) + number + "." : "•"}</span>${(child.content || []).map(render).join("")}</span>`).join("")}</span>`;
  };
  return render(doc);
}
