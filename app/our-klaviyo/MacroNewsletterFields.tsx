"use client";
import { useEffect, useRef, useState } from "react";
import type { Content } from "@/lib/marketing/rules";
import { newsletterDefinition, newsletterFieldVisible, newsletterSectionRemoved, type NewsletterProduct } from "@/lib/marketing/macro-newsletters";
import Artwork from "./EmailArtwork";
import NewsletterRichText from "./NewsletterRichText";
import NewsletterSections from "./NewsletterSections";
import { type NewsletterTextNode } from "@/lib/marketing/newsletter-rich-text";
import { useMarketingBrand } from "./MarketingBrand";

const newId = () => `manual-${crypto.randomUUID()}`;

export default function MacroNewsletterFields({ content, onChange, panel }: {
  content: Content; onChange: (key: keyof Content, value: Content[keyof Content]) => void;
  panel: "content" | "artwork" | "footer" | "products";
}) {
  const newsletter = content.macroNewsletter!;
  const latest = useRef(newsletter);
  useEffect(() => { latest.current = newsletter; }, [newsletter]);
  const definition = newsletterDefinition(newsletter.design);
  const { marketingFetch } = useMarketingBrand();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NewsletterProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const searchVersion = useRef(0);
  const update = (patch: Partial<typeof newsletter>) => {
    latest.current = { ...latest.current, ...patch };
    onChange("macroNewsletter", latest.current);
  };
  const replaceImage = (key: string, patch: Partial<(typeof newsletter.images)[string]>) => update({ images: { ...latest.current.images, [key]: { ...latest.current.images[key], ...patch } } });
  const replaceProduct = (id: string, patch: Partial<NewsletterProduct>) => update({ products: latest.current.products.map(product => product.id === id ? { ...product, ...patch } : product) });
  const textField = (key: string, label: string, plain: string, compact = false, allowLinks = true) => <NewsletterRichText
    key={`${newsletter.design}-${key}`} label={label} text={plain} value={newsletter.richText?.[key]} compact={compact} allowLinks={allowLinks}
    onChange={(doc: NewsletterTextNode, text: string) => {
      if (key === "heading" || key === "body") {
        onChange(key, text);
        update({ richText: { ...latest.current.richText, [key]: doc } });
      } else update({ text: { ...latest.current.text, [key]: text }, richText: { ...latest.current.richText, [key]: doc } });
    }} />;
  const productField = (product: NewsletterProduct, key: "title" | "portion" | "pricePrefix" | "salePrice" | "button", label: string) => <NewsletterRichText
    key={`${product.id}-${key}`} label={label} text={product[key] || ""} value={product.richText?.[key]} compact allowLinks={false}
    onChange={(doc, text) => {
      const current = latest.current.products.find(item => item.id === product.id)!;
      replaceProduct(product.id, { [key]: text, richText: { ...current.richText, [key]: doc } });
    }} />;
  const move = (index: number, direction: -1 | 1) => {
    const products = [...newsletter.products];
    [products[index], products[index + direction]] = [products[index + direction], products[index]];
    update({ products });
  };
  const fields = definition.fields.filter(field => newsletterFieldVisible(newsletter, field.key) && field.type !== "image" && (panel === "footer" ? field.group === "Footer" : panel === "products" ? field.group === "Product grid" : panel === "content" && !["Footer", "Product grid"].includes(field.group)));
  const groupOrder = ["Header", "Opening", "Featured macroalgae", "Habitat photographs", "Reference details", "Article", "Growth and care", "Aquarium care", "Product grid", "Footer"];
  const groups = [...new Set(fields.map(field => field.group))].sort((a, b) => groupOrder.indexOf(a) - groupOrder.indexOf(b));
  return <>
    {panel === "products" && <NewsletterSections newsletter={newsletter} onChange={hiddenSections => update({ hiddenSections })} />}
    {panel === "products" && newsletter.design === "nitrate" && !newsletterSectionRemoved(newsletter, "feature") && <section className="mk-editor-section">
      <h3>Featured macroalgae layout</h3>
      <label>Image and text arrangement<select value={newsletter.featuredLayout || "columns"} onChange={event => update({ featuredLayout: event.target.value === "stacked" ? "stacked" : "columns" })}>
        <option value="columns">Two columns — image beside text</option>
        <option value="stacked">One column — image above text</option>
      </select></label>
      <p>One column keeps the image compact and uncropped, followed by full-width text. Switching layouts keeps all your content and formatting.</p>
    </section>}
    {panel === "content" && !newsletterSectionRemoved(newsletter, "opening") && <section className="mk-editor-section">
      <h3>Opening</h3>
      {textField("heading", "Heading", content.heading, true)}
      {textField("body", "Introduction", content.body)}
      <p className="nl-rich-help">Click a text field to show its formatting tools. Select words to style them; use Enter for paragraphs or Shift+Enter for a line break.</p>
    </section>}
    {panel === "content" && <p className="nl-rich-help">Remove or restore whole sections under Layout → Sections in this email.</p>}
    {groups.map(group => <details key={group} className="mk-editor-section mk-editor-disclosure">
      <summary>{group}</summary>
      <div className="mk-editor-disclosure-body">{fields.filter(field => field.group === group).map((field, index) => <div key={field.key}>
        {field.type === "link" ? <label>{field.label}<input type="url" aria-label={`${group} ${field.label} ${index + 1}`} value={newsletter.links[field.key] || ""} onChange={event => update({ links: { ...newsletter.links, [field.key]: event.target.value } })} /></label>
          : textField(field.key, `${group} ${field.label} ${index + 1}`, newsletter.text[field.key] || "", !field.multiline, field.multiline === true)}
      </div>)}</div>
    </details>)}
    {panel === "artwork" && definition.fields.filter(field => field.type === "image" && newsletterFieldVisible(newsletter, field.key)).map(field => <div key={`${newsletter.design}-${field.key}`} className="mk-editor-section">
      <Artwork label={field.label} value={newsletter.images[field.key]?.src} scale={1} onChange={src => replaceImage(field.key, { src: src || "" })} />
      <label>Image URL<input type="url" value={newsletter.images[field.key]?.src.startsWith("data:") ? "" : newsletter.images[field.key]?.src || ""} placeholder="https://" onChange={event => replaceImage(field.key, { src: event.target.value })} /></label>
      <label>Image description<input value={newsletter.images[field.key]?.alt || ""} onChange={event => replaceImage(field.key, { alt: event.target.value })} /></label>
    </div>)}
    {panel === "footer" && <section className="mk-editor-section">
      <h3>Subscription details</h3>
      <label>Unsubscribe link text<input value={content.footerUnsubscribeLinkText ?? "Unsubscribe"} onChange={event => onChange("footerUnsubscribeLinkText", event.target.value)} /></label>
      <label><input type="checkbox" checked={(newsletter.showPostalAddress ?? content.showPostalAddress) === true} onChange={event => update({ showPostalAddress: event.target.checked })} /> Show business address in this email</label>
      <p>This choice applies only to this campaign or template. Your business address stays saved in Settings.</p>
      <p>The unsubscribe destination is added automatically for each recipient.</p>
    </section>}
    {panel === "products" && newsletterSectionRemoved(newsletter, "products") && <p className="nl-rich-help">The product grid is removed from this email. Restore it above to edit its products.</p>}
    {panel === "products" && !newsletterSectionRemoved(newsletter, "products") && <section className="mk-editor-section">
      <h3>Manually selected products</h3>
      <p>Add, edit, remove, or reorder products. These selections stay with this campaign.</p>
      <label>Find a Macroalgae Farms product<input value={query} onChange={event => { searchVersion.current++; setQuery(event.target.value); setResults([]); setSearching(false); setSearched(false); setError(""); }} /></label>
      <button type="button" disabled={searching || !query.trim()} onClick={async () => {
        const version = ++searchVersion.current;
        setSearching(true); setSearched(false); setError("");
        try {
          const response = await marketingFetch(`/api/marketing?view=campaign-products&q=${encodeURIComponent(query.trim())}`);
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Could not load products.");
          if (version === searchVersion.current) { setResults(result.products || []); setSearched(true); }
        } catch (failure) { if (version === searchVersion.current) setError(failure instanceof Error ? failure.message : "Could not load products."); }
        finally { if (version === searchVersion.current) setSearching(false); }
      }}>{searching ? "Searching…" : "Search products"}</button>
      {error && <p role="alert" className="mk-editor-error">{error}</p>}
      {searched && !results.length && <p role="status">No matching available products. Try a shorter product name, or add a product manually below.</p>}
      {results.map(product => <p key={product.id}>{product.title} · {product.salePrice} <button type="button" disabled={newsletter.products.length >= 40} onClick={() => update({ products: [...newsletter.products, { ...product, id: newId() }] })}>Add {product.title}</button></p>)}
      {newsletter.products.map((product, index) => <details className="mk-campaign-product-card" key={product.id}>
        <summary>{product.title || "Untitled product"}</summary>
        {productField(product, "title", "Product name")}
        {productField(product, "portion", "Portion or option")}
        {productField(product, "pricePrefix", "Price prefix")}
        {productField(product, "salePrice", "Price")}
        <label>Product destination<input type="url" value={product.url} onChange={event => replaceProduct(product.id, { url: event.target.value })} /></label>
        {productField(product, "button", "Shopping link text")}
        <Artwork label={`${product.title || "Product"} photo`} value={product.image} scale={1} onChange={image => replaceProduct(product.id, { image })} />
        <label>Product image URL<input type="url" value={product.image?.startsWith("data:") ? "" : product.image || ""} onChange={event => replaceProduct(product.id, { image: event.target.value })} /></label>
        <label>Image description<input value={product.alt} onChange={event => replaceProduct(product.id, { alt: event.target.value })} /></label>
        <label><input type="checkbox" checked={product.showSalePrice !== false} onChange={event => replaceProduct(product.id, { showSalePrice: event.target.checked })} /> Show price</label>
        <label><input type="checkbox" checked={product.showButton !== false} onChange={event => replaceProduct(product.id, { showButton: event.target.checked })} /> Show shopping link</label>
        <div className="mk-campaign-builder-actions">
          <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>Move up</button>
          <button type="button" disabled={index === newsletter.products.length - 1} onClick={() => move(index, 1)}>Move down</button>
          <button type="button" onClick={() => update({ products: newsletter.products.filter(item => item.id !== product.id) })}>Remove product</button>
        </div>
      </details>)}
      <button type="button" disabled={newsletter.products.length >= 40} onClick={() => update({ products: [...newsletter.products, { id: newId(), title: "Product name", url: "https://www.macroalgaefarms.com/collections/all", portion: "", pricePrefix: "From", salePrice: "", alt: "", button: "View product", showSalePrice: true, showButton: true }] })}>Add a product manually</button>
    </section>}
  </>;
}
