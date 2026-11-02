"use client";
import { useEffect, useRef, useState } from "react";
import type { Content } from "@/lib/marketing/rules";
import { newsletterDefinition, type NewsletterProduct } from "@/lib/marketing/macro-newsletters";
import Artwork from "./EmailArtwork";
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
  const move = (index: number, direction: -1 | 1) => {
    const products = [...newsletter.products];
    [products[index], products[index + direction]] = [products[index + direction], products[index]];
    update({ products });
  };
  const fields = definition.fields.filter(field => field.type !== "image" && (panel === "footer" ? field.group === "Footer" : panel === "products" ? field.group === "Product grid" : panel === "content" && !["Footer", "Product grid"].includes(field.group)));
  const groupOrder = ["Header", "Opening", "Featured macroalgae", "Habitat photographs", "Reference details", "Article", "Growth and care", "Aquarium care", "Product grid", "Footer"];
  const groups = [...new Set(fields.map(field => field.group))].sort((a, b) => groupOrder.indexOf(a) - groupOrder.indexOf(b));
  return <>
    {panel === "content" && <section className="mk-editor-section">
      <h3>Opening</h3>
      <label>Heading<input aria-label="Heading" value={content.heading} onChange={event => onChange("heading", event.target.value)} /></label>
      <label>Introduction<textarea aria-label="Introduction" rows={5} value={content.body} onChange={event => onChange("body", event.target.value)} /></label>
    </section>}
    {groups.map(group => <details key={group} className="mk-editor-section mk-editor-disclosure">
      <summary>{group}</summary>
      <div className="mk-editor-disclosure-body">{fields.filter(field => field.group === group).map((field, index) => <label key={field.key}>
        {field.label}{fields.filter(other => other.group === group && other.label === field.label).length > 1 ? ` ${index + 1}` : ""}
        {field.type === "link" ? <input type="url" aria-label={`${group} ${field.label} ${index + 1}`} value={newsletter.links[field.key] || ""} onChange={event => update({ links: { ...newsletter.links, [field.key]: event.target.value } })} /> : field.multiline ? <textarea rows={4} aria-label={`${group} ${field.label} ${index + 1}`} value={newsletter.text[field.key] || ""} onChange={event => update({ text: { ...newsletter.text, [field.key]: event.target.value } })} /> : <input aria-label={`${group} ${field.label} ${index + 1}`} value={newsletter.text[field.key] || ""} onChange={event => update({ text: { ...newsletter.text, [field.key]: event.target.value } })} />}
      </label>)}</div>
    </details>)}
    {panel === "artwork" && definition.fields.filter(field => field.type === "image").map(field => <div key={`${newsletter.design}-${field.key}`} className="mk-editor-section">
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
    {panel === "products" && <section className="mk-editor-section">
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
        <label>Product name<input value={product.title} onChange={event => replaceProduct(product.id, { title: event.target.value })} /></label>
        <label>Portion or option<input value={product.portion} onChange={event => replaceProduct(product.id, { portion: event.target.value })} /></label>
        <label>Price prefix<input value={product.pricePrefix} onChange={event => replaceProduct(product.id, { pricePrefix: event.target.value })} /></label>
        <label>Price<input value={product.salePrice || ""} onChange={event => replaceProduct(product.id, { salePrice: event.target.value })} /></label>
        <label>Product destination<input type="url" value={product.url} onChange={event => replaceProduct(product.id, { url: event.target.value })} /></label>
        <label>Shopping link text<input value={product.button || ""} onChange={event => replaceProduct(product.id, { button: event.target.value })} /></label>
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
