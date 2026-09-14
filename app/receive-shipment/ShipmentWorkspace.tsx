"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ReefIcon } from "../ReefIcon";

type Mapping = {
  variantId: string;
  inventoryItemId?: string | null;
  productTitle?: string;
  variantTitle?: string;
  name?: string;
  skus?: string[];
};

type ShipmentItem = {
  code: string;
  name: string;
  category: string;
  qty: number;
  stockUp: number | string;
  mapping: Mapping | null;
  status: string;
  selected?: boolean;
  currentStock?: number;
};

type ShipmentSummary = {
  id: string;
  filename: string;
  createdAt: string;
  itemCount: number;
  fishCount?: number;
  invertCount?: number;
  anemoneCount?: number;
};

type Workset = { id?: string; filename: string; items: ShipmentItem[]; reopened?: boolean };
type ProductOption = Mapping & { sku?: string };
type DemandRow = { rank: number; productTitle: string; unitsSold: number; sales: number; currencyCode?: string; rvsCodes?: string[] };
type DemandReport = { rows: DemandRow[]; range: { label: string }; ordersScanned: number; truncated?: boolean; unmapped?: unknown[] };
type View = "receive" | "sales" | "mappings" | "history";

const API = "/shipment-processor/api";
const viewLabels: Record<View, string> = {
  receive: "Receive shipment",
  sales: "Sales demand",
  mappings: "Product mappings",
  history: "Shipment history",
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...options, cache: "no-store" });
  const data = await response.json().catch(() => ({ error: "The server returned an unexpected response." }));
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data as T;
}

function prepareItems(items: ShipmentItem[]) {
  return items.map(item => ({ ...item, selected: Boolean(item.mapping) }));
}

function shortDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown date" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function ShipmentWorkspace() {
  const [view, setView] = useState<View>("receive");
  const [mappings, setMappings] = useState<Record<string, Mapping>>({});
  const [history, setHistory] = useState<ShipmentSummary[]>([]);
  const [receive, setReceive] = useState<Workset | null>(null);
  const [sales, setSales] = useState<Workset | null>(null);
  const [report, setReport] = useState<DemandReport | null>(null);
  const [days, setDays] = useState("30");
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("all");
  const [matchFilter, setMatchFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [matchItem, setMatchItem] = useState<ShipmentItem | null>(null);
  const [matchQuery, setMatchQuery] = useState("");
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [reviewItems, setReviewItems] = useState<ShipmentItem[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
        api<{ mappings: Record<string, Mapping> }>("/mappings"),
        api<{ shipments: ShipmentSummary[] }>("/shipments"),
      ]).then(([mappingData, shipmentData]) => {
      if (!active) return;
      setMappings(mappingData.mappings);
      setHistory(shipmentData.shipments);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Could not load shipment data.");
    }).finally(() => { if (active) setLoading(false); });
    api<{ ok: boolean }>("/debug")
      .then(data => { if (active) setConfigured(data.ok); })
      .catch(() => { if (active) setConfigured(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const workset = view === "sales" ? sales : receive;
  const visibleItems = useMemo(() => (workset?.items || []).filter(item => {
    const text = `${item.name} ${item.code} ${item.mapping?.productTitle || ""}`.toLowerCase();
    return text.includes(filter.toLowerCase()) && (category === "all" || item.category === category) &&
      (matchFilter === "all" || (matchFilter === "mapped") === Boolean(item.mapping));
  }), [workset, filter, category, matchFilter]);
  const selected = (receive?.items || []).filter(item => item.selected && item.mapping && Number.isInteger(Number(item.stockUp)) && Number(item.stockUp) > 0);

  async function upload(file: File) {
    if (!/\.(xlsx|xls)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
      setError("Choose an Excel workbook (.xlsx or .xls) smaller than 10 MB."); return;
    }
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("file", file);
      const path = view === "sales" ? "/process-sales-report" : "/process-shipment";
      const data = await api<{ shipmentId?: string; shipment?: ShipmentSummary; filename?: string; items: ShipmentItem[] }>(path, { method: "POST", body: form });
      const next = { id: data.shipmentId || data.shipment?.id, filename: data.filename || data.shipment?.filename || file.name, items: prepareItems(data.items) };
      if (view === "sales") { setSales(next); setReport(null); }
      else { setReceive(next); const h = await api<{ shipments: ShipmentSummary[] }>("/shipments"); setHistory(h.shipments); }
      setNotice("Spreadsheet imported. Review the items below.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The upload failed."); }
    finally { setBusy(false); }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = "";
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) void upload(file);
  }

  function updateItem(code: string, changes: Partial<ShipmentItem>) {
    setReceive(current => current ? { ...current, items: current.items.map(item => item.code === code ? { ...item, ...changes } : item) } : current);
  }

  async function searchProducts(event?: FormEvent) {
    event?.preventDefault(); if (!matchQuery.trim()) return;
    setBusy(true); setError("");
    try { const data = await api<{ options: ProductOption[] }>(`/search-products?q=${encodeURIComponent(matchQuery.trim())}`); setOptions(data.options); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Product search failed."); }
    finally { setBusy(false); }
  }

  function openMatch(item: ShipmentItem) {
    setMatchItem(item); setMatchQuery(item.mapping?.productTitle || item.name); setOptions([]); setError("");
  }

  async function saveMatch(option: ProductOption) {
    if (!matchItem) return; setBusy(true);
    try {
      const body = { code: matchItem.code, name: matchItem.name, ...option, skus: option.sku ? [option.sku] : option.skus || [] };
      const data = await api<{ mapping: Mapping }>("/confirm-mapping", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      setMappings(current => ({ ...current, [matchItem.code]: data.mapping }));
      const sync = (set: React.Dispatch<React.SetStateAction<Workset | null>>) => set(current => current ? { ...current, items: current.items.map(item => item.code === matchItem.code ? { ...item, mapping: data.mapping, status: "mapped", selected: true } : item) } : current);
      sync(setReceive); sync(setSales); setMatchItem(null); setNotice("Product match saved for future shipments.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save the mapping."); }
    finally { setBusy(false); }
  }

  async function prepareReview() {
    if (!selected.length) return; setBusy(true); setError("");
    try {
      const data = await api<{ stocks: { code: string; currentStock: number }[] }>("/current-stock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: selected }) });
      const reviewed = selected.map(item => ({ ...item, currentStock: data.stocks.find(stock => stock.code === item.code)?.currentStock }));
      if (reviewed.some(item => !Number.isFinite(item.currentStock))) throw new Error("Current stock could not be read for every selected item.");
      const ids = reviewed.map(item => item.mapping?.inventoryItemId || item.mapping?.variantId);
      if (new Set(ids).size !== ids.length) throw new Error("Two selected rows share one Shopify inventory item. Combine their quantities before continuing.");
      setReviewItems(reviewed);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not prepare the stock update."); }
    finally { setBusy(false); }
  }

  async function confirmRestock() {
    if (!reviewItems) return; setBusy(true); setError("");
    try {
      const data = await api<{ results: { result: string; reason?: string }[] }>("/restock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: reviewItems }) });
      const failed = data.results.filter(result => result.result !== "success");
      setReviewItems(null); setReceive(null);
      setNotice(failed.length ? `Stock update finished with ${failed.length} item${failed.length === 1 ? "" : "s"} needing review.` : "Shopify inventory updated successfully.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The stock update could not be confirmed."); }
    finally { setBusy(false); }
  }

  async function analyzeDemand() {
    if (!sales) return; setBusy(true); setError("");
    try { setReport(await api<DemandReport>("/sales-demand", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: sales.items, days }) })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Demand analysis failed."); }
    finally { setBusy(false); }
  }

  async function openShipment(id: string) {
    setBusy(true); setError("");
    try {
      const data = await api<{ shipment: ShipmentSummary; items: ShipmentItem[] }>(`/shipments/${encodeURIComponent(id)}`);
      setReceive({ id, filename: data.shipment.filename, items: prepareItems(data.items), reopened: true }); setView("receive");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open the shipment."); }
    finally { setBusy(false); }
  }

  async function deleteMapping(code: string) {
    if (!window.confirm(`Remove the saved mapping for ${code}?`)) return;
    await api("/mapping", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    setMappings(current => { const next = { ...current }; delete next[code]; return next; }); setNotice("Mapping removed.");
  }

  async function deleteShipment(id: string) {
    if (!window.confirm("Delete this saved shipment? This does not undo stock changes.")) return;
    await api(`/shipments/${encodeURIComponent(id)}`, { method: "DELETE" });
    setHistory(current => current.filter(item => item.id !== id)); setNotice("Shipment removed from history.");
  }

  return <div className="shipment-workspace">
    <header className="shipment-heading"><div><p className="shipment-eyebrow">INVENTORY WORKSPACE</p><h1>{viewLabels[view]}</h1><p>{view === "receive" ? "From supplier invoice to Shopify inventory, in a few clear steps." : view === "sales" ? "See what is moving before you place your next order." : view === "mappings" ? "Saved connections between supplier codes and Shopify products." : "Reopen past invoices with their latest product mappings."}</p></div><span className={`shipment-connection ${configured ? "ready" : ""}`}>{configured ? "Shopify connected" : configured === false ? "Shopify needs setup" : "Checking connection"}</span></header>

    <nav className="shipment-tabs" aria-label="Shipment workspace sections">
      {(Object.keys(viewLabels) as View[]).map(item => <button key={item} className={view === item ? "active" : ""} onClick={() => { setView(item); setFilter(""); setError(""); }}>{viewLabels[item]}</button>)}
    </nav>
    {error && <div className="shipment-callout error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
    {loading ? <div className="shipment-card shipment-loading">Loading shipment workspace…</div> : <>
      {(view === "receive" || view === "sales") && !workset && <UploadPanel sales={view === "sales"} busy={busy} fileInput={fileInput} chooseFile={chooseFile} dropFile={dropFile} />}
      {(view === "receive" || view === "sales") && workset && <>
        {view === "receive" && <div className="shipment-steps"><span className="done"><b>✓</b>Upload invoice</span><span className="active"><b>2</b>Review & match</span><span><b>3</b>Confirm stock</span></div>}
        <section className="shipment-card shipment-file"><div><ReefIcon name="shipment"/><strong>{workset.filename}</strong><small>{workset.reopened ? "Opened from shipment history" : "Spreadsheet imported"}</small></div><button className="button" onClick={() => view === "sales" ? setSales(null) : setReceive(null)}>New upload</button></section>
        {workset.reopened && <div className="shipment-callout warning">This is a previous shipment. Check Shopify before adding its stock again.</div>}
        <div className="shipment-stats"><article><span>Items in report</span><strong>{workset.items.length}</strong></article><article><span>Matched to Shopify</span><strong>{workset.items.filter(i => i.mapping).length}</strong></article><article><span>Need a match</span><strong>{workset.items.filter(i => !i.mapping).length}</strong></article></div>
        <section className="shipment-card"><div className="shipment-toolbar"><input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search items or supplier codes" aria-label="Search shipment items"/><select value={category} onChange={event => setCategory(event.target.value)} aria-label="Filter category"><option value="all">All categories</option><option>Fish</option><option>Invert</option><option>Anemone</option></select><select value={matchFilter} onChange={event => setMatchFilter(event.target.value)} aria-label="Filter match status"><option value="all">All items</option><option value="mapped">Matched</option><option value="unknown">Needs a match</option></select></div>
          <div className="shipment-table-wrap"><table><thead><tr>{view === "receive" && <th aria-label="Select"/>}<th>Supplier item</th><th>Shopify match</th>{view === "receive" && <><th>Invoice qty</th><th>Add to stock</th></>}<th/></tr></thead><tbody>{visibleItems.map(item => <tr key={item.code}>{view === "receive" && <td><input type="checkbox" checked={Boolean(item.selected)} disabled={!item.mapping} onChange={event => updateItem(item.code, { selected: event.target.checked })} aria-label={`Select ${item.name}`}/></td>}<td><strong>{item.name}</strong><small>{item.code} · {item.category}</small></td><td>{item.mapping ? <><strong>{item.mapping.productTitle || item.mapping.name}</strong><small>{item.mapping.variantTitle || "Default variant"}</small></> : <span className="shipment-pill warning">Needs a match</span>}</td>{view === "receive" && <><td>{item.qty}</td><td><input className="shipment-qty" type="number" min="0" step="1" value={item.stockUp} onChange={event => updateItem(item.code, { stockUp: event.target.value })} aria-label={`Add quantity for ${item.name}`}/></td></>}<td><button className="shipment-text-button" onClick={() => openMatch(item)}>{item.mapping ? "Change" : "Find match"}</button></td></tr>)}</tbody></table></div>
        </section>
        {view === "receive" ? <div className="shipment-actionbar"><div><strong>{selected.length} items selected · {selected.reduce((sum, item) => sum + Number(item.stockUp), 0)} units to add</strong><p>Only selected, matched items with a positive quantity will be updated.</p></div><button className="button button-primary" disabled={!selected.length || busy} onClick={() => void prepareReview()}>Review stock update <ReefIcon name="arrow" size={16}/></button></div> : <div className="shipment-actionbar"><div><strong>{sales?.items.filter(i => i.mapping).length || 0} matched items available</strong><p>Unmatched products are excluded from the report.</p></div><div className="shipment-actions"><select value={days} onChange={event => setDays(event.target.value)} aria-label="Sales period"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="60">Last 60 days</option><option value="90">Last 90 days</option><option value="all">All history</option></select><button className="button button-primary" disabled={busy || !sales?.items.some(i => i.mapping)} onClick={() => void analyzeDemand()}>Analyze demand</button></div></div>}
        {report && <DemandResults report={report}/>}</>}
      {view === "mappings" && <Mappings mappings={mappings} busy={busy} edit={code => openMatch({ code, name: mappings[code].name || code, category: "", qty: 0, stockUp: 0, status: "mapped", mapping: mappings[code] })} remove={deleteMapping}/>}
      {view === "history" && <History shipments={history} busy={busy} open={openShipment} remove={deleteShipment}/>}
    </>}
    {matchItem && <div className="shipment-modal-backdrop" role="presentation"><section className="shipment-modal" role="dialog" aria-modal="true" aria-labelledby="match-title"><header><div><h2 id="match-title">Find a Shopify match</h2><p>{matchItem.name} · Supplier code {matchItem.code}</p></div><button onClick={() => setMatchItem(null)} aria-label="Close">×</button></header><form onSubmit={searchProducts}><label>Product name or SKU<input value={matchQuery} onChange={event => setMatchQuery(event.target.value)} autoFocus/></label><button className="button button-primary" disabled={busy}>Search</button></form><div className="shipment-options">{options.map((option, index) => <button key={`${option.variantId}-${index}`} onClick={() => void saveMatch(option)}><span><strong>{option.productTitle}</strong><small>{option.variantTitle || "Default variant"}{option.sku ? ` · ${option.sku}` : ""}</small></span><ReefIcon name="plus" size={18}/></button>)}{!options.length && <p>Search Shopify to choose the exact product and variant.</p>}</div></section></div>}
    {reviewItems && <div className="shipment-modal-backdrop" role="presentation"><section className="shipment-modal shipment-review" role="dialog" aria-modal="true" aria-labelledby="review-title"><header><div><h2 id="review-title">Review stock update</h2><p>Check every addition before changing Shopify inventory.</p></div><button onClick={() => setReviewItems(null)} aria-label="Close">×</button></header><div className="shipment-table-wrap"><table><thead><tr><th>Product</th><th>Current</th><th>Add</th><th>Expected</th></tr></thead><tbody>{reviewItems.map(item => <tr key={item.code}><td><strong>{item.mapping?.productTitle || item.name}</strong><small>{item.mapping?.variantTitle}</small></td><td>{item.currentStock}</td><td>+{item.stockUp}</td><td><strong>{Number(item.currentStock) + Number(item.stockUp)}</strong></td></tr>)}</tbody></table></div><footer><span><strong>+{reviewItems.reduce((sum, item) => sum + Number(item.stockUp), 0)}</strong> total units</span><div><button className="button" onClick={() => setReviewItems(null)}>Back</button><button className="button button-primary" disabled={busy} onClick={() => void confirmRestock()}>{busy ? "Updating…" : "Confirm stock update"}</button></div></footer></section></div>}
    {notice && <div className="shipment-toast" role="status">{notice}</div>}
  </div>;
}

function UploadPanel({ sales, busy, fileInput, chooseFile, dropFile }: { sales: boolean; busy: boolean; fileInput: React.RefObject<HTMLInputElement | null>; chooseFile: (event: ChangeEvent<HTMLInputElement>) => void; dropFile: (event: DragEvent<HTMLDivElement>) => void }) {
  return <><div className="shipment-steps"><span className="active"><b>1</b>Upload invoice</span><span><b>2</b>Review & match</span><span><b>3</b>{sales ? "Analyze demand" : "Confirm stock"}</span></div><div className="shipment-upload-grid"><section className="shipment-card"><header><div><h2>{sales ? "Upload supplier stock list" : "Start with your shipment invoice"}</h2><p>{sales ? "See demand for the products available to order." : "Import your RVS invoice to prepare your restock."}</p></div><span className="shipment-pill">{sales ? "STOCK REPORT" : "RVS INVOICE"}</span></header><div className="shipment-dropzone" onDragOver={event => event.preventDefault()} onDrop={dropFile}><span><ReefIcon name="upload" size={27}/></span><h3>{busy ? "Reading your spreadsheet…" : "Drop your Excel file here"}</h3><p>{sales ? "Use a stock report with CODE and COMMON NAME columns." : "Use the original RVS workbook with a FISH COUNT sheet."}</p><button className="button button-primary" disabled={busy} onClick={() => fileInput.current?.click()}><ReefIcon name="plus" size={16}/> Choose {sales ? "report" : "invoice"}</button><input ref={fileInput} hidden type="file" accept=".xlsx,.xls" onChange={chooseFile}/><small>.xlsx or .xls · up to 10 MB</small></div><p className="shipment-safe"><ReefIcon name="inventory" size={16}/>{sales ? "Uploading a report does not change inventory." : "You will review every item before anything changes in Shopify."}</p></section><aside><section className="shipment-card shipment-guide"><h2>{sales ? "From availability to demand" : "A simpler receiving routine"}</h2>{(sales ? [["Upload the stock list", "Saved mappings connect supplier products."], ["Choose a period", "Review recent Shopify order history."], ["Rank demand", "See what is selling before you order."]] : [["Upload the invoice", "We read livestock names, codes, and quantities."], ["Match and adjust", "Saved mappings apply automatically."], ["Review and confirm", "Current and expected stock appear together."]]).map(([title, copy], index) => <div key={title}><b>0{index + 1}</b><p><strong>{title}</strong><span>{copy}</span></p></div>)}</section></aside></div></>;
}

function Mappings({ mappings, busy, edit, remove }: { mappings: Record<string, Mapping>; busy: boolean; edit: (code: string) => void; remove: (code: string) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const rows = Object.entries(mappings).filter(([code, mapping]) => `${code} ${mapping.name} ${mapping.productTitle} ${mapping.variantTitle}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="shipment-card"><div className="shipment-toolbar"><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search supplier code or Shopify product" aria-label="Search product mappings"/><span className="shipment-pill">{rows.length} saved matches</span></div><div className="shipment-table-wrap"><table><thead><tr><th>Supplier item</th><th>Shopify product</th><th>Variant / SKU</th><th/></tr></thead><tbody>{rows.map(([code, mapping]) => <tr key={code}><td><strong>{mapping.name || code}</strong><small>{code}</small></td><td><strong>{mapping.productTitle || "Mapped product"}</strong></td><td><strong>{mapping.variantTitle || "Default variant"}</strong><small>{(mapping.skus || []).join(", ")}</small></td><td><div className="shipment-actions"><button className="shipment-text-button" disabled={busy} onClick={() => edit(code)}>Edit</button><button className="shipment-text-button danger" disabled={busy} onClick={() => void remove(code)}>Remove</button></div></td></tr>)}</tbody></table>{!rows.length && <p className="shipment-empty">No saved mappings match this search.</p>}</div></section>;
}

function History({ shipments, busy, open, remove }: { shipments: ShipmentSummary[]; busy: boolean; open: (id: string) => Promise<void>; remove: (id: string) => Promise<void> }) {
  const [query, setQuery] = useState(""); const rows = shipments.filter(item => item.filename.toLowerCase().includes(query.toLowerCase()));
  return <section className="shipment-card"><div className="shipment-toolbar"><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search invoice filenames" aria-label="Search shipment history"/><span className="shipment-pill">{rows.length} shipments</span></div><div className="shipment-table-wrap"><table><thead><tr><th>Shipment</th><th>Uploaded</th><th>Items</th><th/></tr></thead><tbody>{rows.map(item => <tr key={item.id}><td><strong>{item.filename}</strong><small>{item.fishCount || 0} fish · {item.invertCount || 0} invertebrate · {item.anemoneCount || 0} anemone</small></td><td>{shortDate(item.createdAt)}</td><td>{item.itemCount}</td><td><div className="shipment-actions"><button className="button" disabled={busy} onClick={() => void open(item.id)}>Open</button><button className="shipment-text-button danger" disabled={busy} onClick={() => void remove(item.id)}>Delete</button></div></td></tr>)}</tbody></table>{!rows.length && <p className="shipment-empty">Uploaded shipments will appear here.</p>}</div></section>;
}

function DemandResults({ report }: { report: DemandReport }) {
  const max = Math.max(1, ...report.rows.map(row => row.unitsSold));
  return <section className="shipment-results"><header><h2>Demand ranking</h2><span>{report.range.label} · {report.ordersScanned} orders scanned</span></header>{report.truncated && <div className="shipment-callout warning">This report reached the order scan limit. Use a shorter period for a more complete result.</div>}<div className="shipment-card shipment-table-wrap"><table><thead><tr><th>Rank</th><th>Shopify product</th><th>Units sold</th><th>Sales</th></tr></thead><tbody>{report.rows.map(row => <tr key={`${row.rank}-${row.productTitle}`}><td><span className="shipment-rank">{row.rank}</span></td><td><strong>{row.productTitle}</strong><small>{(row.rvsCodes || []).join(", ")} · All variants</small></td><td><strong>{row.unitsSold}</strong><div className="shipment-bar"><i style={{ width: `${Math.round(row.unitsSold / max * 100)}%` }}/></div></td><td>{new Intl.NumberFormat("en-US", { style: "currency", currency: row.currencyCode || "USD" }).format(row.sales)}</td></tr>)}</tbody></table>{!report.rows.length && <p className="shipment-empty">No product sales were found for this period.</p>}</div></section>;
}
