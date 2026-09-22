"use client";

import { useState } from "react";
import type {
  CampaignEmailLayout,
  CampaignEmailProduct,
  CampaignEmailSection,
  Content,
} from "@/lib/marketing/rules";
import {
  campaignProductFeed,
  campaignProductFeedOrders,
  campaignProductFeeds,
} from "@/lib/marketing/rules";

const home = "https://coralsanonymous.com/collections/new-arrivals";
const id = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function move<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const blankProduct = (): CampaignEmailProduct => ({
  id: id("product"),
  title: "Product name",
  url: home,
  salePrice: "$0.00",
  compareAtPrice: "$0.00",
  button: "Shop now",
  showSalePrice: true,
  showCompareAtPrice: true,
  showButton: true,
});

export default function CampaignEmailFields({
  content,
  onChange,
  subject,
  onSubject,
  showInbox = true,
}: {
  content: Content;
  onChange: (key: keyof Content, value: Content[keyof Content]) => void;
  subject: string;
  onSubject: (value: string) => void;
  showInbox?: boolean;
}) {
  const [refreshingFeed, setRefreshingFeed] = useState<string | null>(null);
  const [feedError, setFeedError] = useState("");
  const layout = content.campaignLayout!;
  const update = (next: CampaignEmailLayout) => onChange("campaignLayout", next);
  const patchLayout = (patch: Partial<CampaignEmailLayout>) =>
    update({ ...layout, ...patch });
  const patchStyle = (patch: Partial<CampaignEmailLayout["style"]>) =>
    update({ ...layout, style: { ...layout.style, ...patch } });
  const replaceSection = (index: number, section: CampaignEmailSection) =>
    patchLayout({
      sections: layout.sections.map((current, sectionIndex) =>
        sectionIndex === index ? section : current,
      ),
    });
  const replaceProduct = (
    sectionIndex: number,
    productIndex: number,
    product: CampaignEmailProduct,
  ) => {
    const section = layout.sections[sectionIndex];
    if (section.type !== "products") return;
    replaceSection(sectionIndex, {
      ...section,
      products: section.products.map((current, index) =>
        index === productIndex ? product : current,
      ),
    });
  };
  const refreshFeeds = async (sectionId: string) => {
    setRefreshingFeed(sectionId);
    setFeedError("");
    try {
      const response = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview-campaign-feeds", content }),
      });
      const responseText = await response.text();
      let result: { content?: Content; error?: string } = {};
      try {
        result = JSON.parse(responseText) as typeof result;
      } catch {
        if (!response.ok)
          throw new Error(
            "The product preview service did not finish. Please try again in a moment.",
          );
        throw new Error("The product preview returned an unreadable response.");
      }
      if (!response.ok) throw new Error(result.error || "Could not load products.");
      if (!result.content?.campaignLayout)
        throw new Error("The product preview did not include an email layout.");
      const resolved = result.content as Content;
      onChange("campaignLayout", resolved.campaignLayout);
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : "Could not load products.");
    } finally {
      setRefreshingFeed(null);
    }
  };
  return (
    <>
      {showInbox && <section className="mk-editor-section">
        <h3>Inbox details</h3>
        <p>Set the subject and the short preview shown beside it.</p>
        <label>
          Subject
          <input value={subject} onChange={(event) => onSubject(event.target.value)} />
        </label>
        <label>
          Preview text
          <input
            value={content.preview || ""}
            onChange={(event) => onChange("preview", event.target.value)}
          />
        </label>
      </section>}

      <details className="mk-editor-section mk-editor-disclosure">
        <summary><span>Header links</span><small>{layout.navigation.length} links</small></summary>
        <div className="mk-editor-disclosure-body">
        <p>The logo is managed in Artwork. These links sit directly below it.</p>
        {layout.navigation.map((item, index) => (
          <fieldset className="mk-campaign-field-card" key={`${item.label}-${index}`}>
            <legend>Link {index + 1}</legend>
            <label>
              Label
              <input
                value={item.label}
                onChange={(event) =>
                  patchLayout({
                    navigation: layout.navigation.map((current, itemIndex) =>
                      itemIndex === index ? { ...current, label: event.target.value } : current,
                    ),
                  })
                }
              />
            </label>
            <label>
              Destination
              <input
                type="url"
                value={item.url}
                onChange={(event) =>
                  patchLayout({
                    navigation: layout.navigation.map((current, itemIndex) =>
                      itemIndex === index ? { ...current, url: event.target.value } : current,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                patchLayout({ navigation: layout.navigation.filter((_, itemIndex) => itemIndex !== index) })
              }
            >
              Remove link
            </button>
          </fieldset>
        ))}
        {layout.navigation.length < 5 && (
          <button
            type="button"
            onClick={() =>
              patchLayout({ navigation: [...layout.navigation, { label: "New link", url: home }] })
            }
          >
            Add header link
          </button>
        )}
        </div>
      </details>

      <details className="mk-editor-section mk-editor-disclosure">
        <summary><span>Sale banner</span><small>Link destination</small></summary>
        <div className="mk-editor-disclosure-body">
        <p>Upload the full-width banner in Artwork, then choose where it links.</p>
        <label>
          Banner destination
          <input
            type="url"
            value={layout.heroLink || content.url}
            onChange={(event) => patchLayout({ heroLink: event.target.value })}
          />
        </label>
        </div>
      </details>

      <details className="mk-editor-section mk-editor-disclosure">
        <summary><span>Email sections</span><small>{layout.sections.length} sections</small></summary>
        <div className="mk-editor-disclosure-body">
        <p>Add, reorder, and edit product grids and full-width buttons.</p>
        <div className="mk-campaign-section-list">
          {layout.sections.map((section, sectionIndex) => (
            <details className="mk-campaign-builder-card" key={section.id}>
              <summary>
                <span>{section.type === "products" ? `Product grid · ${campaignProductFeed(section.feed)?.name || section.feed?.name || "Manual"} · ${section.feed?.limit || section.products.length}` : section.type === "banner" ? `Full-width banner · ${section.text}` : `Full-width button · ${section.label}`}</span>
              </summary>
              <div className="mk-campaign-builder-actions">
                <button type="button" disabled={sectionIndex === 0} onClick={() => patchLayout({ sections: move(layout.sections, sectionIndex, -1) })}>Move up</button>
                <button type="button" disabled={sectionIndex === layout.sections.length - 1} onClick={() => patchLayout({ sections: move(layout.sections, sectionIndex, 1) })}>Move down</button>
                <button type="button" onClick={() => patchLayout({ sections: layout.sections.filter((_, index) => index !== sectionIndex) })}>Remove</button>
              </div>
              <label>
                Section background
                <input
                  type="color"
                  value={section.backgroundColor || "#ffffff"}
                  onChange={(event) => replaceSection(sectionIndex, { ...section, backgroundColor: event.target.value })}
                />
              </label>
              {section.type === "cta" ? (
                <>
                  <label>Button label<input value={section.label} onChange={(event) => replaceSection(sectionIndex, { ...section, label: event.target.value })} /></label>
                  <label>Destination<input type="url" value={section.url} onChange={(event) => replaceSection(sectionIndex, { ...section, url: event.target.value })} /></label>
                  <label>Text color<input type="color" value={section.textColor || "#ffffff"} onChange={(event) => replaceSection(sectionIndex, { ...section, textColor: event.target.value })} /></label>
                </>
              ) : section.type === "banner" ? (
                <>
                  <label>Banner text<input value={section.text} onChange={(event) => replaceSection(sectionIndex, { ...section, text: event.target.value })} /></label>
                  <label>Highlighted text<input value={section.accent || ""} onChange={(event) => replaceSection(sectionIndex, { ...section, accent: event.target.value || undefined })} /></label>
                  <label>Destination<input type="url" value={section.url} onChange={(event) => replaceSection(sectionIndex, { ...section, url: event.target.value })} /></label>
                  <div className="mk-campaign-color-grid">
                    <label>Text color<input type="color" value={section.textColor || "#080808"} onChange={(event) => replaceSection(sectionIndex, { ...section, textColor: event.target.value })} /></label>
                    <label>Highlight color<input type="color" value={section.accentColor || "#5439ee"} onChange={(event) => replaceSection(sectionIndex, { ...section, accentColor: event.target.value })} /></label>
                    <label>Border color<input type="color" value={section.borderColor || "#5439ee"} onChange={(event) => replaceSection(sectionIndex, { ...section, borderColor: event.target.value })} /></label>
                  </div>
                  <label className="mk-check"><input type="checkbox" checked={section.accentPill === true} onChange={(event) => replaceSection(sectionIndex, { ...section, accentPill: event.target.checked })} /> Show highlighted text as a pill</label>
                  <label>Border width <span>{section.borderWidth || 0}px</span><input type="range" min="0" max="8" value={section.borderWidth || 0} onChange={(event) => replaceSection(sectionIndex, { ...section, borderWidth: Number(event.target.value) })} /></label>
                </>
              ) : (
                <div className="mk-campaign-products">
                  <label>
                    Product selection
                    <select
                      value={section.feed?.key || "manual"}
                      onChange={(event) => {
                        const feed = campaignProductFeed({ key: event.target.value });
                        replaceSection(sectionIndex, {
                          ...section,
                          feed,
                          products: feed ? [] : section.products,
                        });
                      }}
                    >
                      <option value="manual">Choose products manually</option>
                      {campaignProductFeeds.map((feed) => (
                        <option key={feed.key} value={feed.key}>{feed.name}</option>
                      ))}
                    </select>
                  </label>
                  {section.feed && (
                    <div className="mk-campaign-feed-card">
                      <strong>{campaignProductFeed(section.feed)?.name || section.feed.name}</strong>
                      <span>
                        {section.feed.tags.length
                          ? `Tag includes ${section.feed.tags.join(" OR ")}. `
                          : "All categories. "}
                        Product selection and availability are checked when the campaign is prepared.
                      </span>
                      <div className="mk-campaign-two-fields">
                        <label>
                          Number of products
                          <input
                            type="number"
                            min="1"
                            max="40"
                            value={section.feed.limit}
                            onChange={(event) => {
                              const feed = campaignProductFeed({
                                ...section.feed,
                                limit: Number(event.target.value),
                              });
                              if (feed)
                                replaceSection(sectionIndex, {
                                  ...section,
                                  feed,
                                  products: [],
                                });
                            }}
                          />
                        </label>
                        <label>
                          Product order
                          <select
                            value={section.feed.order}
                            onChange={(event) => {
                              const feed = campaignProductFeed({
                                ...section.feed,
                                order: event.target.value,
                              });
                              if (feed)
                                replaceSection(sectionIndex, {
                                  ...section,
                                  feed,
                                  products: [],
                                });
                            }}
                          >
                            {campaignProductFeedOrders.map((order) => (
                              <option key={order.value} value={order.value}>
                                {order.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <span>{section.feed.limit} products appear in this grid.</span>
                      <button
                        type="button"
                        disabled={refreshingFeed !== null}
                        onClick={() => refreshFeeds(section.id)}
                      >
                        {refreshingFeed === section.id ? "Loading products…" : "Refresh product preview"}
                      </button>
                    </div>
                  )}
                  {feedError && refreshingFeed === null && <p className="mk-editor-error">{feedError}</p>}
                  {section.feed && section.products.length > 0 && (
                    <details className="mk-campaign-feed-preview">
                      <summary>Current preview · {section.products.length} products</summary>
                      <ol>{section.products.map((product) => <li key={product.id}>{product.title}</li>)}</ol>
                    </details>
                  )}
                  {!section.feed && section.products.map((product, productIndex) => (
                    <details className="mk-campaign-product-card" key={product.id}>
                      <summary>Product {productIndex + 1} · {product.title}</summary>
                      <label>Product name<input value={product.title} onChange={(event) => replaceProduct(sectionIndex, productIndex, { ...product, title: event.target.value })} /></label>
                      <label>Product image URL<input type="url" value={product.image || ""} placeholder="https://" onChange={(event) => replaceProduct(sectionIndex, productIndex, { ...product, image: event.target.value || undefined })} /></label>
                      <label>Destination<input type="url" value={product.url} onChange={(event) => replaceProduct(sectionIndex, productIndex, { ...product, url: event.target.value })} /></label>
                      <div className="mk-campaign-two-fields">
                        <label>Sale price<input value={product.salePrice || ""} onChange={(event) => replaceProduct(sectionIndex, productIndex, { ...product, salePrice: event.target.value })} /></label>
                        <label>Compare-at price<input value={product.compareAtPrice || ""} onChange={(event) => replaceProduct(sectionIndex, productIndex, { ...product, compareAtPrice: event.target.value })} /></label>
                      </div>
                      <label>Button label<input value={product.button || ""} onChange={(event) => replaceProduct(sectionIndex, productIndex, { ...product, button: event.target.value })} /></label>
                      <label>Image width <span>{product.imageWidth || layout.style.productImageWidth}px</span><input type="range" min="60" max="280" value={product.imageWidth || layout.style.productImageWidth} onChange={(event) => replaceProduct(sectionIndex, productIndex, { ...product, imageWidth: Number(event.target.value) })} /></label>
                      <div className="mk-campaign-visibility">
                        {([
                          ["showSalePrice", "Show sale price"],
                          ["showCompareAtPrice", "Show compare-at price"],
                          ["showButton", "Show button"],
                        ] as const).map(([key, label]) => (
                          <label key={key}><input type="checkbox" checked={product[key] !== false} onChange={(event) => replaceProduct(sectionIndex, productIndex, { ...product, [key]: event.target.checked })} /> {label}</label>
                        ))}
                      </div>
                      <div className="mk-campaign-builder-actions">
                        <button type="button" disabled={productIndex === 0} onClick={() => replaceSection(sectionIndex, { ...section, products: move(section.products, productIndex, -1) })}>Move up</button>
                        <button type="button" disabled={productIndex === section.products.length - 1} onClick={() => replaceSection(sectionIndex, { ...section, products: move(section.products, productIndex, 1) })}>Move down</button>
                        <button type="button" onClick={() => replaceSection(sectionIndex, { ...section, products: section.products.filter((_, index) => index !== productIndex) })}>Remove</button>
                      </div>
                    </details>
                  ))}
                  {!section.feed && <button type="button" onClick={() => replaceSection(sectionIndex, { ...section, products: [...section.products, blankProduct()] })}>Add product</button>}
                </div>
              )}
            </details>
          ))}
        </div>
        <div className="mk-campaign-add-row">
          <button type="button" onClick={() => patchLayout({ sections: [...layout.sections, { id: id("products"), type: "products", backgroundColor: "#ffffff", products: [blankProduct(), blankProduct()] }] })}>Add product grid</button>
          <button type="button" onClick={() => patchLayout({ sections: [...layout.sections, { id: id("cta"), type: "cta", label: "SHOP NOW!", url: home, backgroundColor: "#3c8429", textColor: "#ffffff" }] })}>Add full-width button</button>
          <button type="button" onClick={() => patchLayout({ sections: [...layout.sections, { id: id("banner"), type: "banner", text: "Promotional banner", url: home, backgroundColor: "#ffffff", textColor: "#080808", accentColor: "#5439ee", borderColor: "#5439ee", borderWidth: 0 }] })}>Add full-width banner</button>
        </div>
        </div>
      </details>

      <details className="mk-editor-section mk-editor-disclosure">
        <summary><span>Design</span><small>Colors, type and spacing</small></summary>
        <div className="mk-editor-disclosure-body">
        <p>Safe email styles are applied inline for consistent delivery.</p>
        <label>
          Logo width <span>{Math.round(360 * (content.logoScale ?? 1))}px</span>
          <input
            aria-label="Logo width"
            type="range"
            min="180"
            max="560"
            step="10"
            value={Math.min(560, Math.max(180, Math.round(360 * (content.logoScale ?? 1))))}
            onChange={(event) =>
              onChange("logoScale", Number(event.target.value) / 360)
            }
          />
        </label>
        <label>Font<select value={layout.style.fontFamily} onChange={(event) => patchStyle({ fontFamily: event.target.value as CampaignEmailLayout["style"]["fontFamily"] })}><option>Arial</option><option>Verdana</option><option>Georgia</option><option>Trebuchet MS</option></select></label>
        <label>Product alignment<select value={layout.style.productAlignment} onChange={(event) => patchStyle({ productAlignment: event.target.value as CampaignEmailLayout["style"]["productAlignment"] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
        <div className="mk-campaign-color-grid">
          {([
            ["emailBackground", "Email background"], ["contentBackground", "Content background"],
            ["textColor", "Text"], ["salePriceColor", "Sale price"],
            ["buttonBackground", "Buttons"], ["buttonTextColor", "Button text"],
          ] as const).map(([key, label]) => <label key={key}>{label}<input type="color" value={layout.style[key]} onChange={(event) => patchStyle({ [key]: event.target.value })} /></label>)}
        </div>
        {([
          ["productImageWidth", "Default image width", 60, 280], ["productGap", "Product spacing", 0, 60],
          ["sectionPadding", "Section padding", 0, 60], ["buttonRadius", "Button rounding", 0, 40],
          ["titleSize", "Product title size", 11, 32], ["priceSize", "Price size", 11, 34],
        ] as const).map(([key, label, min, max]) => (
          <label key={key}>{label} <span>{layout.style[key]}px</span><input type="range" min={min} max={max} value={layout.style[key]} onChange={(event) => patchStyle({ [key]: Number(event.target.value) })} /></label>
        ))}
        </div>
      </details>
    </>
  );
}
