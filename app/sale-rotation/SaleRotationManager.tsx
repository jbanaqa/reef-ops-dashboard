"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";

type Settings = {
  saleCollectionId: string | null; enabled: boolean; dryRun: boolean; rotationIntervalHours: number;
  discountCount5: number; discountCount10: number; discountCount15: number; discountCount20: number;
  lastRotatedAt: string | null;
};
type Product = {
  id: string; shopifyProductId: string; shopifyVariantId: string; title: string; variantTitle: string | null;
  imageUrl: string | null; regularPrice: number; discountPercent: number | null; eligibleForRotation: boolean;
  twentyPercentCandidate: boolean; fixedInSale: boolean; active: boolean;
};
type Run = { id: string; status: string; triggerType: string; dryRun: boolean; message: string | null; startedAt: string; _count: { items: number } };
type CatalogProduct = { id: string; title: string; handle: string; featuredImage: { url: string } | null; alreadyImported: boolean; variants: Array<{ id: string; title: string; standardPrice: number }> };
type Preview = { selectedCount: number; collection: { title: string; productCount: number; automated: boolean }; shortages: Array<{ discount: number; requested: number; actual: number; shortage: number }>; actions: Array<{ action: string; assignedDiscountPercent: number | null; salePrice: number | null; product: Product }> };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || "Request failed.");
  return body;
}

export default function SaleRotationManager() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, { productId: string; variantId: string; discountPercent: number }>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [status, productData] = await Promise.all([
      api<{ settings: Settings; runs: Run[] }>("/api/sale-rotation"),
      api<{ products: Product[] }>("/api/sale-rotation/products"),
    ]);
    setSettings(status.settings); setRuns(status.runs); setProducts(productData.products);
  }, []);
  useEffect(() => {
    // Loading completes asynchronously; state updates happen after the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((error) => setMessage({ kind: "error", text: error.message }));
  }, [load]);

  const tierTotals = useMemo(() => [5, 10, 15, 20].map((tier) => ({ tier, count: products.filter((product) => product.active && (tier === 20 ? product.twentyPercentCandidate : product.eligibleForRotation && product.discountPercent === tier)).length })), [products]);

  async function saveSettings(event: FormEvent) {
    event.preventDefault(); if (!settings) return;
    setBusy("settings"); setMessage(null);
    try {
      const result = await api<{ settings: Settings }>("/api/sale-rotation", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(result.settings); setMessage({ kind: "success", text: "Sale rotation settings saved." });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not save settings." }); }
    finally { setBusy(""); }
  }

  async function patchProduct(id: string, values: Record<string, unknown>) {
    setBusy(id); setMessage(null);
    try {
      const result = await api<{ product: Product }>(`/api/sale-rotation/products/${id}`, { method: "PATCH", body: JSON.stringify(values) });
      setProducts((current) => current.map((product) => product.id === id ? result.product : product)); setPreview(null);
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not update product." }); }
    finally { setBusy(""); }
  }

  async function searchCatalog(event: FormEvent) {
    event.preventDefault(); setBusy("catalog"); setMessage(null);
    try { setCatalog((await api<{ products: CatalogProduct[] }>(`/api/sale-rotation/catalog?q=${encodeURIComponent(search)}`)).products); }
    catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not search Shopify." }); }
    finally { setBusy(""); }
  }

  function toggleCatalog(product: CatalogProduct) {
    const variant = product.variants[0]; if (!variant || product.alreadyImported) return;
    setSelected((current) => current[product.id]
      ? Object.fromEntries(Object.entries(current).filter(([id]) => id !== product.id))
      : { ...current, [product.id]: { productId: product.id, variantId: variant.id, discountPercent: 5 } });
  }

  async function importSelected() {
    setBusy("import"); setMessage(null);
    try {
      await api("/api/sale-rotation/products", { method: "POST", body: JSON.stringify({ items: Object.values(selected).map((item) => ({ shopifyProductId: item.productId, shopifyVariantId: item.variantId, discountPercent: item.discountPercent })) }) });
      setSelected({}); setCatalog([]); await load(); setMessage({ kind: "success", text: "Products imported from Shopify." });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not import products." }); }
    finally { setBusy(""); }
  }

  async function loadPreview() {
    setBusy("preview"); setMessage(null);
    try { setPreview((await api<{ preview: Preview }>("/api/sale-rotation/preview")).preview); }
    catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not build preview." }); }
    finally { setBusy(""); }
  }

  async function runRotation() {
    if (!settings || (!settings.dryRun && !window.confirm("This will change live Shopify prices and Sale collection membership. Continue?"))) return;
    setBusy("run"); setMessage(null);
    try {
      const result = await api<{ message: string }>("/api/sale-rotation/run", { method: "POST" });
      await load(); setPreview(null); setMessage({ kind: "success", text: result.message });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Sale rotation failed." }); }
    finally { setBusy(""); }
  }

  if (!settings) return <section className="card card-padded">Loading Sale Rotation…</section>;
  return <>
    {message ? <div className={`sale-alert sale-alert-${message.kind}`} role="status">{message.text}</div> : null}
    <section className="sale-metrics">
      {tierTotals.map(({ tier, count }) => <div className="card sale-metric" key={tier}><span>{tier}% pool</span><strong>{count}</strong><small>configured products</small></div>)}
      <div className="card sale-metric"><span>Protection</span><strong>{settings.dryRun ? "Dry run" : "Live"}</strong><small>{settings.enabled ? "automation enabled" : "automation paused"}</small></div>
    </section>

    <form className="card card-padded sale-settings" onSubmit={saveSettings}>
      <div className="sale-section-heading"><div><h3>Rotation settings</h3><p>Configure the Shopify Sale collection, tier sizes, cadence, and write protection.</p></div><button className="button button-primary" disabled={busy === "settings"}>{busy === "settings" ? "Saving…" : "Save settings"}</button></div>
      <div className="sale-form-grid">
        <label><span>Sale collection ID</span><input className="form-input" value={settings.saleCollectionId ?? ""} onChange={(event) => setSettings({ ...settings, saleCollectionId: event.target.value })} placeholder="gid://shopify/Collection/…" /></label>
        <label><span>Rotation interval (hours)</span><input className="form-input" type="number" min="1" max="720" value={settings.rotationIntervalHours} onChange={(event) => setSettings({ ...settings, rotationIntervalHours: Number(event.target.value) })} /></label>
        {[5, 10, 15, 20].map((tier) => { const key = `discountCount${tier}` as keyof Settings; return <label key={tier}><span>{tier}% products per rotation</span><input className="form-input" type="number" min="0" max="500" value={String(settings[key])} onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })} /></label>; })}
      </div>
      <div className="sale-switches">
        <label><input type="checkbox" checked={settings.dryRun} onChange={(event) => setSettings({ ...settings, dryRun: event.target.checked })} /><span><strong>Dry-run protection</strong><small>Calculate and record rotations without changing Shopify.</small></span></label>
        <label><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} /><span><strong>Automatic rotation</strong><small>Run when the shared Reef Ops scheduler reaches the configured cadence.</small></span></label>
      </div>
    </form>

    <section className="card card-padded">
      <div className="sale-section-heading"><div><h3>Product pool</h3><p>Import verified Shopify products, assign their tier, and control their role.</p></div></div>
      <form className="sale-search" onSubmit={searchCatalog}><input className="form-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Macroalgae Shopify products" /><button className="button button-secondary" disabled={busy === "catalog"}>{busy === "catalog" ? "Searching…" : "Search Shopify"}</button></form>
      {catalog.length ? <div className="sale-catalog">
        {catalog.map((product) => <div className={`sale-catalog-row ${product.alreadyImported ? "is-disabled" : ""}`} key={product.id}>
          <input type="checkbox" checked={Boolean(selected[product.id])} disabled={product.alreadyImported || !product.variants.length} onChange={() => toggleCatalog(product)} />
          {product.featuredImage ? <Image src={product.featuredImage.url} alt="" width={42} height={42} unoptimized /> : <span className="sale-image-empty" />}
          <div><strong>{product.title}</strong><small>{product.alreadyImported ? "Already imported" : product.variants[0] ? `${product.variants[0].title} · $${product.variants[0].standardPrice.toFixed(2)}` : "No variants"}</small></div>
          {selected[product.id] ? <select className="form-select" value={selected[product.id].discountPercent} onChange={(event) => setSelected({ ...selected, [product.id]: { ...selected[product.id], discountPercent: Number(event.target.value) } })}>{[5,10,15,20].map((tier) => <option key={tier} value={tier}>{tier}% tier</option>)}</select> : null}
        </div>)}
        <button type="button" className="button button-primary sale-import" disabled={!Object.keys(selected).length || busy === "import"} onClick={importSelected}>{busy === "import" ? "Importing…" : `Import ${Object.keys(selected).length} selected`}</button>
      </div> : null}
      <div className="sale-table-wrap"><table className="sale-table"><thead><tr><th>Product</th><th>Standard price</th><th>Tier</th><th>Rotating</th><th>20% pool</th><th>Fixed</th><th>Active</th></tr></thead><tbody>
        {products.map((product) => <tr key={product.id} className={!product.active ? "is-muted" : ""}><td><div className="sale-product-cell">{product.imageUrl ? <Image src={product.imageUrl} alt="" width={42} height={42} unoptimized /> : <span className="sale-image-empty" />}<span><strong>{product.title}</strong><small>{product.variantTitle}</small></span></div></td><td>${product.regularPrice.toFixed(2)}</td><td><select className="form-select" value={product.discountPercent ?? ""} disabled={busy === product.id} onChange={(event) => patchProduct(product.id, { discountPercent: Number(event.target.value) })}>{[5,10,15,20].map((tier) => <option key={tier} value={tier}>{tier}%</option>)}</select></td>
          <td><input type="checkbox" checked={product.eligibleForRotation} disabled={busy === product.id || product.twentyPercentCandidate} onChange={(event) => patchProduct(product.id, { eligibleForRotation: event.target.checked })} /></td>
          <td><input type="checkbox" checked={product.twentyPercentCandidate} disabled={busy === product.id} onChange={(event) => patchProduct(product.id, { twentyPercentCandidate: event.target.checked, discountPercent: event.target.checked ? 20 : 5, eligibleForRotation: !event.target.checked })} /></td>
          <td><input type="checkbox" checked={product.fixedInSale} disabled={busy === product.id || !product.twentyPercentCandidate} onChange={(event) => patchProduct(product.id, { fixedInSale: event.target.checked })} /></td>
          <td><input type="checkbox" checked={product.active} disabled={busy === product.id} onChange={(event) => patchProduct(product.id, { active: event.target.checked })} /></td></tr>)}
        {!products.length ? <tr><td colSpan={7} className="sale-empty">No products imported yet. Search Shopify above to build the pool.</td></tr> : null}
      </tbody></table></div>
    </section>

    <section className="card card-padded">
      <div className="sale-section-heading"><div><h3>Next rotation</h3><p>Preview the exact adds, removals, discounts, and price changes before running.</p></div><div className="sale-actions"><button className="button button-secondary" onClick={loadPreview} disabled={Boolean(busy)}>{busy === "preview" ? "Building…" : "Generate preview"}</button><button className="button button-primary" onClick={runRotation} disabled={Boolean(busy)}>{busy === "run" ? "Running…" : settings.dryRun ? "Run dry rotation" : "Run live rotation"}</button></div></div>
      {preview ? <><div className="sale-preview-summary"><span><strong>{preview.collection.title}</strong><small>{preview.collection.productCount} currently in collection · {preview.collection.automated ? "automated" : "manual"} collection</small></span><span><strong>{preview.selectedCount}</strong><small>selected for next sale</small></span></div>
        {preview.shortages.some((item) => item.shortage) ? <div className="sale-alert sale-alert-error">The pool cannot fill every tier: {preview.shortages.filter((item) => item.shortage).map((item) => `${item.discount}% is short ${item.shortage}`).join(", ")}.</div> : null}
        <div className="sale-preview-list">{preview.actions.map((item) => <div key={item.product.id}><span className={`sale-action sale-action-${item.action.toLowerCase()}`}>{item.action}</span><strong>{item.product.title}</strong><span>{item.assignedDiscountPercent ? `${item.assignedDiscountPercent}% · $${item.salePrice?.toFixed(2)}` : `Restore $${item.product.regularPrice.toFixed(2)}`}</span></div>)}</div></> : <p className="sale-empty">Generate a preview to inspect the next rotation.</p>}
    </section>

    <section className="card card-padded"><div className="sale-section-heading"><div><h3>Recent runs</h3><p>Audit history for manual and scheduled rotations.</p></div></div><div className="sale-run-list">{runs.map((run) => <div key={run.id}><span><strong>{run.status}</strong><small>{run.triggerType} · {run._count.items} actions</small></span><span><strong>{new Date(run.startedAt).toLocaleString()}</strong><small>{run.message}</small></span></div>)}{!runs.length ? <p className="sale-empty">No sale rotations have run yet.</p> : null}</div></section>
  </>;
}
