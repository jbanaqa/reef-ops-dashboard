"use client";

import { useRef, useState } from "react";
import {
  BLACK_FRIDAY_DAILY_PRODUCTS,
  BLACK_FRIDAY_MAX_SECTION_PRODUCTS,
  BLACK_FRIDAY_MAX_SECTIONS,
  type BlackFridayCollection,
  type BlackFridayDesign,
} from "@/lib/marketing/black-friday";
import type { CampaignEmailProduct } from "@/lib/marketing/rules";
import { useMarketingRequest } from "./MarketingBrand";

function move<T>(items: T[], index: number, direction: -1 | 1) {
  const next = index + direction;
  if (next < 0 || next >= items.length) return items;
  const reordered = [...items];
  [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
  return reordered;
}

function productPath(value: string) {
  try {
    return new URL(value).pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return value;
  }
}

function ProductThumbnail({ product }: { product: CampaignEmailProduct }) {
  if (!product.image) return null;
  // eslint-disable-next-line @next/next/no-img-element -- Shopify catalog image URLs are supplied by the search result.
  return <img className="mk-bf-product-photo" width={40} height={40} alt="" loading="lazy" src={product.image} />;
}

export function BlackFridayProductPicker({ products, limit, onChange, editVariantLabel = false }: {
  products: CampaignEmailProduct[];
  limit: number;
  onChange: (products: CampaignEmailProduct[]) => void;
  editVariantLabel?: boolean;
}) {
  const request = useMarketingRequest();
  const searchVersion = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CampaignEmailProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const isSelected = (product: CampaignEmailProduct) => products.some(current =>
    current.id === product.id || productPath(current.url) === productPath(product.url),
  );

  async function search() {
    const terms = query.trim();
    if (!terms || searching) return;
    const version = ++searchVersion.current;
    setSearching(true);
    setSearched(false);
    setResults([]);
    setError("");
    try {
      const result = await request<{ products: CampaignEmailProduct[] }>(
        `/api/marketing?view=black-friday-products&q=${encodeURIComponent(terms)}`,
      );
      if (version !== searchVersion.current) return;
      setResults(result.products);
      setSearched(true);
    } catch (failure) {
      if (version === searchVersion.current) {
        setError(failure instanceof Error ? failure.message : "Could not load products. Try again.");
      }
    } finally {
      if (version === searchVersion.current) setSearching(false);
    }
  }

  return <div className="mk-bf-product-picker">
    <div className="mk-bf-product-count"><strong>Selected products</strong><span>{products.length} / {limit}</span></div>
    {products.length === 0 && <p>Search Shopify to add products to this section.</p>}
    {products.length > 0 && <ul className="mk-bf-product-list" aria-label="Selected products">
      {products.map((product, index) => <li key={product.id}>
        <div className="mk-bf-product-info">
          <ProductThumbnail product={product} />
          <div><strong>{product.title}</strong>{product.salePrice && <span>{product.salePrice}</span>}</div>
        </div>
        {editVariantLabel && <label>Variant label
          <input
            aria-label={`Variant label for ${product.title}`}
            value={product.variantLabel || ""}
            maxLength={120}
            onChange={event => onChange(products.map((current, itemIndex) =>
              itemIndex === index ? { ...current, variantLabel: event.target.value } : current,
            ))}
          />
        </label>}
        <div className="mk-campaign-builder-actions">
          <button type="button" aria-label={`Move ${product.title} up`} disabled={index === 0} onClick={() => onChange(move(products, index, -1))}>↑</button>
          <button type="button" aria-label={`Move ${product.title} down`} disabled={index === products.length - 1} onClick={() => onChange(move(products, index, 1))}>↓</button>
          <button type="button" aria-label={`Remove ${product.title}`} onClick={() => onChange(products.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
        </div>
      </li>)}
    </ul>}
    <label>Find a Shopify product
      <input
        value={query}
        maxLength={120}
        placeholder="Search by name"
        onChange={(event) => {
          searchVersion.current++;
          setQuery(event.target.value);
          setResults([]);
          setSearching(false);
          setSearched(false);
          setError("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void search();
          }
        }}
      />
    </label>
    <button type="button" disabled={searching || !query.trim()} onClick={search}>{searching ? "Searching…" : "Search products"}</button>
    {products.length === limit && <p>Remove a product to make room for another.</p>}
    {error && <p role="alert" className="mk-editor-error">{error}</p>}
    {searched && !results.length && <p role="status">No matching available products. Try a shorter name.</p>}
    {results.length > 0 && <ul className="mk-bf-product-list" aria-label="Shopify search results">
      {results.map((product) => {
        const selected = isSelected(product);
        return <li key={product.id}>
          <div className="mk-bf-product-info">
            <ProductThumbnail product={product} />
            <div><strong>{product.title}</strong>{editVariantLabel && product.variantLabel && <span>{product.variantLabel}</span>}{product.salePrice && <span>{product.salePrice}</span>}</div>
          </div>
          <button
            type="button"
            aria-label={selected ? `${product.title} is selected` : `Add ${product.title}`}
            disabled={selected || products.length >= limit}
            onClick={() => onChange([...products, editVariantLabel ? product : { ...product, button: "View deal" }])}
          >{selected ? "Selected" : "Add"}</button>
        </li>;
      })}
    </ul>}
  </div>;
}

export default function BlackFridayFields({ design, onChange }: {
  design: BlackFridayDesign;
  onChange: (design: BlackFridayDesign) => void;
}) {
  const patchSection = (id: string, patch: Partial<BlackFridayCollection>) =>
    onChange({
      ...design,
      sections: design.sections.map(section => section.id === id ? { ...section, ...patch } : section),
    });
  const [openSectionId, setOpenSectionId] = useState("");

  return <>
    <details className="mk-editor-section mk-editor-disclosure">
      <summary><span>Daily Super Deals</span><small>{design.dailyProducts.length} / {BLACK_FRIDAY_DAILY_PRODUCTS} products</small></summary>
      <div className="mk-editor-disclosure-body">
        <p>The timer counts down to the next midnight Pacific time each time the email app fetches it. Some inboxes may show a saved or still image. The Daily Super Deals link takes shoppers to the current offers.</p>
        <label>Live Daily Super Deals URL
          <input type="url" maxLength={500} value={design.dailyDealsUrl} onChange={event => onChange({ ...design, dailyDealsUrl: event.target.value })} />
        </label>
        <BlackFridayProductPicker products={design.dailyProducts} limit={BLACK_FRIDAY_DAILY_PRODUCTS} onChange={dailyProducts => onChange({ ...design, dailyProducts })} />
      </div>
    </details>
    <section className="mk-editor-section" aria-label="Collection sections">
      <h3>Collection sections</h3>
      <p>Choose what appears below Daily Super Deals. Edit the heading, collection link and products for each section.</p>
      <div className="mk-campaign-section-list">
        {design.sections.map((section, index) => <details className="mk-campaign-builder-card" key={section.id} open={section.id === openSectionId || undefined} onToggle={event => {
          if (!event.currentTarget.open) setOpenSectionId(current => current === section.id ? "" : current);
        }}>
          <summary>{section.title.trim() || `Collection section ${index + 1}`} · {section.products.length} / {BLACK_FRIDAY_MAX_SECTION_PRODUCTS} products</summary>
          <div className="mk-campaign-builder-actions">
            <button type="button" disabled={index === 0} onClick={() => onChange({ ...design, sections: move(design.sections, index, -1) })}>Move up</button>
            <button type="button" disabled={index === design.sections.length - 1} onClick={() => onChange({ ...design, sections: move(design.sections, index, 1) })}>Move down</button>
            <button type="button" onClick={() => onChange({ ...design, sections: design.sections.filter(current => current.id !== section.id) })}>Remove section</button>
          </div>
          <label>Section title
            <input maxLength={100} value={section.title} onChange={event => patchSection(section.id, { title: event.target.value })} />
          </label>
          <label>Subtitle (optional)
            <input maxLength={160} value={section.subtitle || ""} onChange={event => patchSection(section.id, { subtitle: event.target.value })} />
          </label>
          <label>Collection link text
            <input maxLength={100} placeholder="Shop this collection" value={section.linkLabel || ""} onChange={event => patchSection(section.id, { linkLabel: event.target.value })} />
          </label>
          <label>Collection URL
            <input type="url" maxLength={500} placeholder="https://coralsanonymous.com/collections/…" value={section.linkUrl || ""} onChange={event => patchSection(section.id, { linkUrl: event.target.value })} />
          </label>
          <p className="mk-bf-link-help">The collection link appears below the products when you enter both fields.</p>
          <BlackFridayProductPicker products={section.products} limit={BLACK_FRIDAY_MAX_SECTION_PRODUCTS} onChange={products => patchSection(section.id, { products })} />
        </details>)}
      </div>
      {design.sections.length === 0 && <p>Add a collection section to feature more products below Daily Super Deals.</p>}
      <button type="button" disabled={design.sections.length >= BLACK_FRIDAY_MAX_SECTIONS} onClick={() => {
        const id = crypto.randomUUID();
        onChange({ ...design, sections: [...design.sections, { id, title: "New collection", linkLabel: "", linkUrl: "", products: [] }] });
        setOpenSectionId(id);
      }}>Add collection section</button>
      {design.sections.length >= BLACK_FRIDAY_MAX_SECTIONS && <p>You can add up to {BLACK_FRIDAY_MAX_SECTIONS} collection sections.</p>}
    </section>
  </>;
}
