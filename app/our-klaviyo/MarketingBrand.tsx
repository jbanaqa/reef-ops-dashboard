"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useId, type CSSProperties, type ReactNode } from "react";
import { marketingBrand, marketingBrands, type MarketingBrand } from "@/lib/marketing/brands";

const storageKey = "reef-marketing-brand";
function scopedUrl(path: string, brand: MarketingBrand) {
  const url = new URL(path, "https://reef-ops.invalid");
  url.searchParams.set("brand", brand);
  return url.pathname + url.search + url.hash;
}
function brandScope(id: MarketingBrand) {
  return {
    brand: marketingBrand(id),
    apiUrl: (path = "/api/marketing") => scopedUrl(path, id),
    href: (path: string) => scopedUrl(path, id),
    marketingFetch: (path: string, options?: RequestInit) => fetch(scopedUrl(path, id), options),
    setHasUnsavedChanges: (() => {}) as (value: boolean, key?: string) => void,
  };
}
const MarketingBrandContext = createContext(brandScope("corals-anonymous"));
export const useMarketingBrand = () => useContext(MarketingBrandContext);
export function useMarketingUnsavedChanges(dirty: boolean) {
  const { setHasUnsavedChanges } = useMarketingBrand();
  const key = useId();
  useEffect(() => {
    setHasUnsavedChanges(dirty, key);
    return () => setHasUnsavedChanges(false, key);
  }, [dirty, key, setHasUnsavedChanges]);
}
export function useMarketingRequest() {
  const { marketingFetch } = useMarketingBrand();
  return useCallback(async <T,>(url: string, options?: RequestInit): Promise<T> => {
    const response = await marketingFetch(url, { cache: "no-store", ...options });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
    return result as T;
  }, [marketingFetch]);
}
export function useMarketingAction() {
  const request = useMarketingRequest();
  return useCallback(<T,>(body: unknown) => request<T>("/api/marketing", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), [request]);
}

export default function MarketingBrandWorkspace({ tab, initialBrand, children }: {
  tab: string;
  initialBrand?: MarketingBrand;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<MarketingBrand | null>(initialBrand || null);
  const [selectionError, setSelectionError] = useState("");
  const [dirtySources, setDirtySources] = useState<string[]>([]);
  const hasUnsavedChanges = dirtySources.length > 0;
  const setHasUnsavedChanges = useCallback((value: boolean, key = "workspace") => {
    setDirtySources((current) => value ? current.includes(key) ? current : [...current, key] : current.includes(key) ? current.filter((item) => item !== key) : current);
  }, []);
  const remember = useCallback((brand: MarketingBrand) => {
    try { localStorage.setItem(storageKey, brand); } catch { /* The URL keeps the choice when storage is unavailable. */ }
    const url = new URL(window.location.href);
    url.searchParams.set("brand", brand);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
    if (!active) return;
    try {
      const explicit = new URL(window.location.href).searchParams.get("brand");
      let saved: string | null = null;
      try { saved = localStorage.getItem(storageKey); } catch { /* Storage is optional. */ }
      let brand: MarketingBrand;
      if (initialBrand || explicit !== null) brand = marketingBrand(initialBrand || explicit).id;
      else {
        try { brand = marketingBrand(saved || undefined).id; }
        catch { brand = "corals-anonymous"; }
      }
      remember(brand);
      setSelected(brand);
    } catch (error) { setSelectionError(error instanceof Error ? error.message : "Choose a marketing brand."); }
    });
    return () => { active = false; };
  }, [initialBrand, remember]);
  const scope = useMemo(() => selected ? { ...brandScope(selected), setHasUnsavedChanges } : null, [selected, setHasUnsavedChanges]);
  function selectBrand(next: MarketingBrand) {
    if (next === selected) return;
    const name = marketingBrand(next).name;
    if (hasUnsavedChanges && !window.confirm(`Switch to ${name} and discard unsaved edits? Save your changes first if you want to keep them.`)) return;
    remember(next);
    setDirtySources([]);
    setSelectionError("");
    setSelected(next);
  }
  const tabs = [
    ["campaigns", "Campaigns"], ["audiences", "Audiences"], ["templates", "Templates"], ["analytics", "Analytics"],
    ...(selected === "corals-anonymous" ? [["flows", "Flows"], ["forms", "Forms"]] : []),
    ["settings", "Settings"],
  ];
  return <section className="marketing-brand-workspace" data-brand={selected || "loading"} style={scope ? { "--brand": scope.brand.accent } as CSSProperties : undefined}>
    <header className="mk-brand-bar">
      <div><span className="mk-brand-label">MARKETING BRAND</span><strong>{scope?.brand.name || "Choose your brand"}</strong>{scope && <small>{scope.brand.storefrontOrigin.replace("https://", "")}</small>}</div>
      <div className="mk-brand-choices" role="group" aria-label="Marketing brand">
        {marketingBrands.map(brand => <button type="button" key={brand.id} aria-pressed={selected === brand.id} onClick={() => selectBrand(brand.id)} data-brand={brand.id}>
          <span aria-hidden="true" style={{ background: brand.accent }} />{brand.name}
        </button>)}
      </div>
    </header>
    {selectionError && <p role="alert" className="mk-alert">{selectionError}</p>}
    {!scope && !selectionError && <p role="status">Loading your marketing workspace…</p>}
    {scope && <MarketingBrandContext.Provider value={scope}>
      <nav className="mk-brand-tabs" aria-label={`${scope.brand.name} marketing`}>
        {tabs.map(([key, label]) => <a key={key} href={scope.href(`/our-klaviyo/${key}`)} aria-current={tab === key ? "page" : undefined}>{label}</a>)}
      </nav>
      <div key={scope.brand.id}>{children}</div>
    </MarketingBrandContext.Provider>}
  </section>;
}
