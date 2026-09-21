"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Settings = {
  saleCollectionId: string | null;
  enabled: boolean;
  dryRun: boolean;
  rotationIntervalHours: number;
  discountCount5: number;
  discountCount10: number;
  discountCount15: number;
  discountCount20: number;
  lastRotatedAt: string | null;
};

type Product = {
  id: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  title: string;
  variantTitle: string | null;
  imageUrl: string | null;
  regularPrice: number;
  discountPercent: number | null;
  eligibleForRotation: boolean;
  twentyPercentCandidate: boolean;
  fixedInSale: boolean;
  active: boolean;
};

type Run = {
  id: string;
  status: string;
  triggerType: string;
  dryRun: boolean;
  message: string | null;
  startedAt: string;
  _count: { items: number };
};

type CatalogProduct = {
  id: string;
  title: string;
  handle: string;
  featuredImage: { url: string } | null;
  alreadyImported: boolean;
  variants: Array<{ id: string; title: string; standardPrice: number }>;
};

type Preview = {
  selectedCount: number;
  collection: { title: string; productCount: number; automated: boolean };
  shortages: Array<{ discount: number; requested: number; actual: number; shortage: number }>;
  actions: Array<{
    action: string;
    assignedDiscountPercent: number | null;
    salePrice: number | null;
    product: Product;
  }>;
  warnings: string[];
};

type ProductRole = "standard" | "twenty" | "fixed";
type ProductFilter = "active" | "standard" | "twenty" | "inactive";
type PreviewFilter = "ALL" | "ADD" | "KEEP" | "REMOVE";

const PRODUCT_PAGE_SIZE = 12;
const PREVIEW_PAGE_SIZE = 10;
const TIERS = [5, 10, 15, 20] as const;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function roleFor(product: Product): ProductRole {
  if (product.twentyPercentCandidate) return product.fixedInSale ? "fixed" : "twenty";
  return "standard";
}

function formatDate(value: string | null) {
  if (!value) return "Not yet run";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function ProductImage({ product, size = 52 }: { product: { imageUrl?: string | null; featuredImage?: { url: string } | null; title: string }; size?: number }) {
  const url = product.imageUrl ?? product.featuredImage?.url;
  return url
    ? <Image src={url} alt="" width={size} height={size} unoptimized />
    : <span className="sale-image-empty" aria-hidden="true">◌</span>;
}

export default function SaleRotationManager() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savedSettings, setSavedSettings] = useState<Settings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [poolSearch, setPoolSearch] = useState("");
  const [productFilter, setProductFilter] = useState<ProductFilter>("active");
  const [productPage, setProductPage] = useState(1);
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>("ALL");
  const [previewPage, setPreviewPage] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, { productId: string; variantId: string; discountPercent: number }>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [status, productData] = await Promise.all([
      api<{ settings: Settings; runs: Run[] }>("/api/sale-rotation"),
      api<{ products: Product[] }>("/api/sale-rotation/products"),
    ]);
    setSettings(status.settings);
    setSavedSettings(status.settings);
    setRuns(status.runs);
    setProducts(productData.products);
  }, []);

  useEffect(() => {
    // Loading completes asynchronously; state updates happen after the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((error) => setMessage({ kind: "error", text: error.message }));
  }, [load]);

  const tierTotals = useMemo(() => TIERS.map((tier) => ({
    tier,
    count: settings?.[`discountCount${tier}` as keyof Settings] as number ?? 0,
  })), [settings]);
  const tierTotal = tierTotals.reduce((total, tier) => total + tier.count, 0);
  const settingsDirty = Boolean(settings && savedSettings && JSON.stringify(settings) !== JSON.stringify(savedSettings));

  const poolCounts = useMemo(() => ({
    active: products.filter((product) => product.active).length,
    standard: products.filter((product) => product.active && roleFor(product) === "standard").length,
    twenty: products.filter((product) => product.active && ["twenty", "fixed"].includes(roleFor(product))).length,
    fixed: products.filter((product) => product.active && roleFor(product) === "fixed").length,
    inactive: products.filter((product) => !product.active).length,
  }), [products]);

  const filteredProducts = useMemo(() => {
    const query = poolSearch.trim().toLowerCase();
    return products.filter((product) => {
      const role = roleFor(product);
      const matchesFilter = productFilter === "active" ? product.active
        : productFilter === "standard" ? product.active && role === "standard"
          : productFilter === "twenty" ? product.active && (role === "twenty" || role === "fixed")
            : !product.active;
      const matchesSearch = !query || `${product.title} ${product.variantTitle ?? ""}`.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [poolSearch, productFilter, products]);

  const productPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCT_PAGE_SIZE));
  const visibleProducts = filteredProducts.slice((productPage - 1) * PRODUCT_PAGE_SIZE, productPage * PRODUCT_PAGE_SIZE);

  const previewCounts = useMemo(() => {
    const counts = { ADD: 0, KEEP: 0, REMOVE: 0 };
    preview?.actions.forEach((item) => {
      if (item.action in counts) counts[item.action as keyof typeof counts] += 1;
    });
    return counts;
  }, [preview]);
  const filteredPreview = preview?.actions.filter((item) => previewFilter === "ALL" || item.action === previewFilter) ?? [];
  const previewPages = Math.max(1, Math.ceil(filteredPreview.length / PREVIEW_PAGE_SIZE));
  const visiblePreview = filteredPreview.slice((previewPage - 1) * PREVIEW_PAGE_SIZE, previewPage * PREVIEW_PAGE_SIZE);

  const nextRotationAt = settings?.lastRotatedAt
    ? new Date(new Date(settings.lastRotatedAt).getTime() + settings.rotationIntervalHours * 3_600_000).toISOString()
    : null;

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settings || tierTotal !== 60) return;
    setBusy("settings");
    setMessage(null);
    try {
      const result = await api<{ settings: Settings }>("/api/sale-rotation", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSettings(result.settings);
      setSavedSettings(result.settings);
      setSettingsOpen(false);
      setMessage({ kind: "success", text: "Sale rotation settings saved." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not save settings." });
    } finally {
      setBusy("");
    }
  }

  async function patchProduct(id: string, values: Record<string, unknown>) {
    setBusy(id);
    setMessage(null);
    try {
      const result = await api<{ product: Product }>(`/api/sale-rotation/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      setProducts((current) => current.map((product) => product.id === id ? result.product : product));
      setPreview(null);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not update product." });
    } finally {
      setBusy("");
    }
  }

  async function changeProductRole(product: Product, role: ProductRole) {
    const values = role === "standard"
      ? { eligibleForRotation: true, twentyPercentCandidate: false, fixedInSale: false, discountPercent: 5 }
      : role === "twenty"
        ? { eligibleForRotation: false, twentyPercentCandidate: true, fixedInSale: false, discountPercent: 20 }
        : { eligibleForRotation: false, twentyPercentCandidate: true, fixedInSale: true, discountPercent: 20 };
    await patchProduct(product.id, values);
  }

  async function searchCatalog(event: FormEvent) {
    event.preventDefault();
    setBusy("catalog");
    setMessage(null);
    try {
      setCatalog((await api<{ products: CatalogProduct[] }>(`/api/sale-rotation/catalog?q=${encodeURIComponent(catalogSearch)}`)).products);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not search Shopify." });
    } finally {
      setBusy("");
    }
  }

  function toggleCatalog(product: CatalogProduct) {
    const variant = product.variants[0];
    if (!variant || product.alreadyImported) return;
    setSelected((current) => current[product.id]
      ? Object.fromEntries(Object.entries(current).filter(([id]) => id !== product.id))
      : { ...current, [product.id]: { productId: product.id, variantId: variant.id, discountPercent: 5 } });
  }

  async function importSelected() {
    setBusy("import");
    setMessage(null);
    try {
      await api("/api/sale-rotation/products", {
        method: "POST",
        body: JSON.stringify({
          items: Object.values(selected).map((item) => ({
            shopifyProductId: item.productId,
            shopifyVariantId: item.variantId,
            discountPercent: item.discountPercent,
          })),
        }),
      });
      const importedCount = Object.keys(selected).length;
      setSelected({});
      setCatalog([]);
      setCatalogSearch("");
      setImportOpen(false);
      await load();
      setMessage({ kind: "success", text: `${importedCount} ${importedCount === 1 ? "product" : "products"} added to the pool.` });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not import products." });
    } finally {
      setBusy("");
    }
  }

  async function loadPreview() {
    setBusy("preview");
    setMessage(null);
    try {
      setPreview((await api<{ preview: Preview }>("/api/sale-rotation/preview")).preview);
      setPreviewFilter("ALL");
      setPreviewPage(1);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not build preview." });
    } finally {
      setBusy("");
    }
  }

  async function runRotation() {
    if (!settings || (!settings.dryRun && !window.confirm("This will change live Shopify prices and Sale collection membership. Continue?"))) return;
    setBusy("run");
    setMessage(null);
    try {
      const result = await api<{ message: string; preview: Preview }>("/api/sale-rotation/run", { method: "POST" });
      await load();
      setPreview(null);
      setMessage({ kind: "success", text: [result.message, ...result.preview.warnings].join(" ") });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Sale rotation failed." });
    } finally {
      setBusy("");
    }
  }

  function chooseProductFilter(filter: ProductFilter) {
    setProductFilter(filter);
    setProductPage(1);
  }

  function choosePreviewFilter(filter: PreviewFilter) {
    setPreviewFilter(filter);
    setPreviewPage(1);
  }

  if (!settings) {
    return <section className="card sale-loading" aria-live="polite"><span className="sale-spinner" />Loading Sale Rotation…</section>;
  }

  return <>
    {message ? <div className={`sale-alert sale-alert-${message.kind}`} role="status" aria-live="polite"><span>{message.kind === "success" ? "✓" : "!"}</span><p>{message.text}</p><button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message">×</button></div> : null}

    <section className="card sale-command" aria-labelledby="sale-command-title">
      <div className="sale-command-main">
        <span className={`sale-status-pill ${settings.enabled ? "is-live" : "is-paused"}`}><i />{settings.enabled ? "Automation on" : "Automation paused"}</span>
        <h3 id="sale-command-title">{settings.enabled ? "Your weekly sale is running automatically" : "Automatic rotations are paused"}</h3>
        <p>{settings.enabled
          ? `The next rotation is due ${formatDate(nextRotationAt)}. Previewing is always safe and will not change Shopify.`
          : "You can still preview or run a rotation manually. Turn automation back on in settings when you are ready."}</p>
        <div className="sale-command-actions">
          <button type="button" className="button button-primary" onClick={loadPreview} disabled={Boolean(busy)}>{busy === "preview" ? "Building preview…" : "Preview next rotation"}</button>
          <button type="button" className="button button-secondary" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>{settingsOpen ? "Close settings" : "Edit settings"}</button>
        </div>
      </div>
      <div className="sale-command-facts">
        <div><span>Shopify changes</span><strong>{settings.dryRun ? "Dry run only" : "Live"}</strong><small>{settings.dryRun ? "No prices will be changed" : "Prices and collection will update"}</small></div>
        <div><span>Last rotation</span><strong>{formatDate(settings.lastRotatedAt)}</strong><small>{settings.rotationIntervalHours} hours between rotations</small></div>
        <div><span>Product pool</span><strong>{poolCounts.active} active</strong><small>{poolCounts.fixed} fixed at 20%</small></div>
      </div>
      <div className="sale-tier-overview" aria-label={`${tierTotal} total sale slots`}>
        <div className="sale-tier-heading"><strong>{tierTotal} sale slots</strong><span>Discount mix for every rotation</span></div>
        <div className="sale-tier-bar" aria-hidden="true">
          {tierTotals.map(({ tier, count }) => <span key={tier} className={`tier-${tier}`} style={{ width: `${tierTotal ? count / tierTotal * 100 : 0}%` }} />)}
        </div>
        <div className="sale-tier-legend">{tierTotals.map(({ tier, count }) => <span key={tier}><i className={`tier-${tier}`} /><strong>{count}</strong> at {tier}%</span>)}</div>
      </div>
    </section>

    {settingsOpen ? <form className="card sale-settings" onSubmit={saveSettings}>
      <div className="sale-section-heading">
        <div><span className="sale-kicker">Configuration</span><h3>Rotation settings</h3><p>Controls when the automation runs and how 60 sale slots are allocated.</p></div>
        {settingsDirty ? <span className="sale-unsaved">Unsaved changes</span> : null}
      </div>

      <div className="sale-setting-groups">
        <fieldset className="sale-setting-group">
          <legend>Automatic schedule</legend>
          <p>Choose whether Reef Ops should rotate the sale when it becomes due.</p>
          <div className="sale-choice" role="group" aria-label="Automatic rotation">
            <button type="button" className={!settings.enabled ? "is-selected" : ""} aria-pressed={!settings.enabled} onClick={() => setSettings({ ...settings, enabled: false })}><strong>Paused</strong><small>Manual runs only</small></button>
            <button type="button" className={settings.enabled ? "is-selected" : ""} aria-pressed={settings.enabled} onClick={() => setSettings({ ...settings, enabled: true })}><strong>Automatic</strong><small>Run when due</small></button>
          </div>
          <label className="sale-field"><span>Time between rotations</span><div className="sale-input-suffix"><input className="form-input" type="number" min="1" max="720" value={settings.rotationIntervalHours} onChange={(event) => setSettings({ ...settings, rotationIntervalHours: Number(event.target.value) })} /><span>hours</span></div><small>Currently about {(settings.rotationIntervalHours / 24).toFixed(1)} days.</small></label>
        </fieldset>

        <fieldset className="sale-setting-group">
          <legend>Shopify write mode</legend>
          <p>Dry run records the plan. Live mode changes prices, tags, and collection membership.</p>
          <div className="sale-choice" role="group" aria-label="Shopify write mode">
            <button type="button" className={settings.dryRun ? "is-selected" : ""} aria-pressed={settings.dryRun} onClick={() => setSettings({ ...settings, dryRun: true })}><strong>Dry run</strong><small>Plan without changes</small></button>
            <button type="button" className={!settings.dryRun ? "is-selected is-live-choice" : ""} aria-pressed={!settings.dryRun} onClick={() => setSettings({ ...settings, dryRun: false })}><strong>Live changes</strong><small>Update Shopify</small></button>
          </div>
        </fieldset>
      </div>

      <fieldset className="sale-tier-settings">
        <legend>Discount mix</legend>
        <div className="sale-tier-settings-heading"><p>Every rotation must contain exactly 60 products.</p><span className={tierTotal === 60 ? "is-valid" : "is-invalid"}>{tierTotal} / 60 slots</span></div>
        <div className="sale-tier-inputs">
          {TIERS.map((tier) => {
            const key = `discountCount${tier}` as keyof Settings;
            return <label key={tier} className={`tier-${tier}`}><span>{tier}% off</span><input className="form-input" type="number" min="0" max="500" value={String(settings[key])} onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })} /><small>products</small></label>;
          })}
        </div>
        {tierTotal !== 60 ? <p className="sale-field-error">Adjust the tier counts so they total exactly 60 before saving.</p> : null}
      </fieldset>

      <details className="sale-advanced">
        <summary>Shopify collection connection</summary>
        <div><label className="sale-field"><span>Sale collection ID</span><input className="form-input" value={settings.saleCollectionId ?? ""} onChange={(event) => setSettings({ ...settings, saleCollectionId: event.target.value })} placeholder="gid://shopify/Collection/…" /><small>Only change this if the Shopify Sale collection itself changes.</small></label></div>
      </details>

      <div className="sale-form-actions">
        <button type="button" className="button button-secondary" onClick={() => { setSettings(savedSettings); setSettingsOpen(false); }}>Cancel</button>
        <button className="button button-primary" disabled={busy === "settings" || tierTotal !== 60 || !settingsDirty}>{busy === "settings" ? "Saving…" : "Save settings"}</button>
      </div>
    </form> : null}

    <section className="card sale-next" id="next-rotation" aria-labelledby="sale-next-title">
      <div className="sale-section-heading">
        <div><span className="sale-kicker">Review and run</span><h3 id="sale-next-title">Next rotation</h3><p>Review the exact changes before you choose to run them.</p></div>
        <div className="sale-actions">
          <button type="button" className="button button-secondary" onClick={loadPreview} disabled={Boolean(busy)}>{busy === "preview" ? "Refreshing…" : preview ? "Refresh preview" : "Generate preview"}</button>
          <button type="button" className="button button-primary" onClick={runRotation} disabled={Boolean(busy)}>{busy === "run" ? "Running…" : settings.dryRun ? "Run dry rotation" : "Run live rotation now"}</button>
        </div>
      </div>

      {preview ? <>
        <div className="sale-preview-overview">
          <div><span>Next sale</span><strong>{preview.selectedCount} products</strong><small>{preview.collection.title}</small></div>
          <div className="is-add"><span>Add</span><strong>{previewCounts.ADD}</strong><small>entering the sale</small></div>
          <div className="is-keep"><span>Keep</span><strong>{previewCounts.KEEP}</strong><small>staying on sale</small></div>
          <div className="is-remove"><span>Remove</span><strong>{previewCounts.REMOVE}</strong><small>returning to regular price</small></div>
        </div>

        {preview.shortages.some((item) => item.shortage) ? <div className="sale-alert sale-alert-error"><span>!</span><p>The pool cannot fill every tier: {preview.shortages.filter((item) => item.shortage).map((item) => `${item.discount}% is short ${item.shortage}`).join(", ")}.</p></div> : null}
        {preview.warnings.map((warning) => <div className="sale-alert sale-alert-error" key={warning}><span>!</span><p>{warning}</p></div>)}

        <div className="sale-review-toolbar">
          <div className="sale-filter-tabs" role="group" aria-label="Filter preview changes">
            {(["ALL", "ADD", "KEEP", "REMOVE"] as const).map((filter) => {
              const count = filter === "ALL" ? preview.actions.length : previewCounts[filter];
              return <button type="button" key={filter} className={previewFilter === filter ? "is-active" : ""} aria-pressed={previewFilter === filter} onClick={() => choosePreviewFilter(filter)}>{filter === "ALL" ? "All changes" : filter[0] + filter.slice(1).toLowerCase()} <span>{count}</span></button>;
            })}
          </div>
          <span>{filteredPreview.length} changes</span>
        </div>

        <div className="sale-change-list">
          {visiblePreview.map((item) => <article key={item.product.id}>
            <ProductImage product={item.product} size={46} />
            <div className="sale-change-product"><strong>{item.product.title}</strong><small>{item.product.variantTitle || "Default variant"}</small></div>
            <span className={`sale-action sale-action-${item.action.toLowerCase()}`}>{item.action}</span>
            <div className="sale-change-price"><strong>{item.assignedDiscountPercent ? `${item.assignedDiscountPercent}% off` : "Regular price"}</strong><small>{item.assignedDiscountPercent ? `$${item.product.regularPrice.toFixed(2)} → $${item.salePrice?.toFixed(2)}` : `Restore $${item.product.regularPrice.toFixed(2)}`}</small></div>
          </article>)}
        </div>
        <Pagination page={previewPage} pages={previewPages} onPage={setPreviewPage} label="preview changes" />
      </> : <div className="sale-empty-state"><span aria-hidden="true">↻</span><h4>See the next sale before it runs</h4><p>A preview calculates the selection and price changes without changing Shopify.</p><button type="button" className="button button-secondary" onClick={loadPreview} disabled={Boolean(busy)}>{busy === "preview" ? "Building preview…" : "Generate preview"}</button></div>}
    </section>

    <section className="card sale-pool" id="product-pool" aria-labelledby="sale-pool-title">
      <div className="sale-section-heading">
        <div><span className="sale-kicker">Product selection</span><h3 id="sale-pool-title">Product pool</h3><p>Assign a clear sale role to each product. Only active, in-stock products can be selected.</p></div>
        <button type="button" className="button button-secondary" onClick={() => setImportOpen((open) => !open)} aria-expanded={importOpen}>{importOpen ? "Close Shopify search" : "Add Shopify products"}</button>
      </div>

      {importOpen ? <div className="sale-import-panel">
        <div><h4>Add products from Shopify</h4><p>Search the catalog, queue products, choose their starting role, then import once.</p></div>
        <form className="sale-search" onSubmit={searchCatalog}><label><span className="sale-sr-only">Search Shopify products</span><input className="form-input" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Search by product name" /></label><button className="button button-secondary" disabled={busy === "catalog" || !catalogSearch.trim()}>{busy === "catalog" ? "Searching…" : "Search Shopify"}</button></form>
        {catalog.length ? <div className="sale-catalog-grid">{catalog.map((product) => {
          const queued = Boolean(selected[product.id]);
          const variant = product.variants[0];
          return <article className={product.alreadyImported || !variant ? "is-disabled" : ""} key={product.id}>
            <ProductImage product={product} size={48} />
            <div className="sale-catalog-copy"><strong>{product.title}</strong><small>{product.alreadyImported ? "Already in the product pool" : variant ? `${variant.title} · $${variant.standardPrice.toFixed(2)}` : "No purchasable variant"}</small></div>
            <button type="button" className={queued ? "sale-queue-button is-queued" : "sale-queue-button"} aria-pressed={queued} disabled={product.alreadyImported || !variant} onClick={() => toggleCatalog(product)}>{product.alreadyImported ? "Added" : queued ? "Queued ✓" : "Add"}</button>
            {queued ? <label><span>Starting role</span><select className="form-select" value={selected[product.id].discountPercent} onChange={(event) => setSelected({ ...selected, [product.id]: { ...selected[product.id], discountPercent: Number(event.target.value) } })}><option value={5}>Standard rotation</option><option value={20}>20% rotation</option></select></label> : null}
          </article>;
        })}</div> : <div className="sale-import-empty">Search Shopify to find products that are not already in the pool.</div>}
        {Object.keys(selected).length ? <div className="sale-import-footer"><span><strong>{Object.keys(selected).length}</strong> queued for import</span><button type="button" className="button button-primary" disabled={busy === "import"} onClick={importSelected}>{busy === "import" ? "Importing…" : "Add queued products"}</button></div> : null}
      </div> : null}

      <div className="sale-pool-summary" aria-label="Product pool summary">
        <div><strong>{poolCounts.active}</strong><span>Active products</span></div>
        <div><strong>{poolCounts.standard}</strong><span>Standard rotation</span></div>
        <div><strong>{poolCounts.twenty}</strong><span>20% pool</span></div>
        <div><strong>{poolCounts.fixed}</strong><span>Fixed at 20%</span></div>
      </div>

      <div className="sale-pool-toolbar">
        <label className="sale-pool-search"><span className="sale-sr-only">Search product pool</span><input className="form-input" value={poolSearch} onChange={(event) => { setPoolSearch(event.target.value); setProductPage(1); }} placeholder="Find a product in this pool" /></label>
        <div className="sale-filter-tabs" role="group" aria-label="Filter product pool">
          {([
            ["active", "Active", poolCounts.active],
            ["standard", "Standard", poolCounts.standard],
            ["twenty", "20% pool", poolCounts.twenty],
            ["inactive", "Inactive", poolCounts.inactive],
          ] as const).map(([filter, label, count]) => <button type="button" key={filter} className={productFilter === filter ? "is-active" : ""} aria-pressed={productFilter === filter} onClick={() => chooseProductFilter(filter)}>{label} <span>{count}</span></button>)}
        </div>
      </div>

      {visibleProducts.length ? <div className="sale-product-grid">{visibleProducts.map((product) => {
        const role = roleFor(product);
        return <article className={!product.active ? "is-inactive" : ""} key={product.id}>
          <div className="sale-product-top">
            <ProductImage product={product} />
            <div><strong>{product.title}</strong><small>{product.variantTitle || "Default variant"}</small><span>${product.regularPrice.toFixed(2)} regular price</span></div>
            <span className={`sale-availability ${product.active ? "is-active" : ""}`}><i />{product.active ? "Active" : "Inactive"}</span>
          </div>
          <div className="sale-product-controls">
            <label><span>Sale role</span><select className="form-select" value={role} disabled={busy === product.id || !product.active} onChange={(event) => changeProductRole(product, event.target.value as ProductRole)}><option value="standard">Standard rotation</option><option value="twenty">20% rotation</option><option value="fixed">Fixed at 20%</option></select></label>
            <button type="button" className="sale-state-button" disabled={busy === product.id} onClick={() => patchProduct(product.id, { active: !product.active })}>{busy === product.id ? "Saving…" : product.active ? "Mark inactive" : "Reactivate"}</button>
          </div>
          <p>{!product.active ? "Unavailable products stay out of automatic sale selections." : role === "standard" ? "Rotates through the 5%, 10%, and 15% tiers." : role === "twenty" ? "Eligible for an open 20% slot." : "Always included in a 20% slot."}</p>
        </article>;
      })}</div> : <div className="sale-empty-state sale-pool-empty"><span aria-hidden="true">⌕</span><h4>No matching products</h4><p>Try another filter or clear your search.</p><button type="button" className="button button-secondary" onClick={() => { setPoolSearch(""); chooseProductFilter("active"); }}>Show active products</button></div>}
      <Pagination page={productPage} pages={productPages} onPage={setProductPage} label="product pool" />
    </section>

    <section className="card sale-history" aria-labelledby="sale-history-title">
      <div className="sale-section-heading">
        <div><span className="sale-kicker">Audit trail</span><h3 id="sale-history-title">Recent rotations</h3><p>See what ran, when it ran, and whether it changed Shopify.</p></div>
        {runs.length > 5 ? <button type="button" className="sale-text-button" onClick={() => setHistoryOpen((open) => !open)}>{historyOpen ? "Show latest 5" : `View all ${runs.length}`}</button> : null}
      </div>
      <div className="sale-run-list">{runs.slice(0, historyOpen ? runs.length : 5).map((run) => <article key={run.id}>
        <span className={`sale-run-status is-${run.status.toLowerCase().replaceAll(" ", "-")}`}>{run.status}</span>
        <div><strong>{run.triggerType} rotation</strong><small>{run._count.items} product actions · {run.dryRun ? "Dry run" : "Live"}</small></div>
        <time dateTime={run.startedAt}>{formatDate(run.startedAt)}</time>
        {run.message ? <details><summary>Details</summary><p>{run.message}</p></details> : null}
      </article>)}{!runs.length ? <div className="sale-empty-state"><h4>No rotation history yet</h4><p>Your first manual or scheduled run will appear here.</p></div> : null}</div>
    </section>
  </>;
}

function Pagination({ page, pages, onPage, label }: { page: number; pages: number; onPage: (page: number) => void; label: string }) {
  if (pages <= 1) return null;
  return <nav className="sale-pagination" aria-label={`Pagination for ${label}`}>
    <button type="button" onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1}>← Previous</button>
    <span>Page <strong>{page}</strong> of {pages}</span>
    <button type="button" onClick={() => onPage(Math.min(pages, page + 1))} disabled={page === pages}>Next →</button>
  </nav>;
}
