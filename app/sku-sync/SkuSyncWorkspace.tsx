"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReefIcon } from "../ReefIcon";

type Store = "A" | "B";
type Variant = {
  variantId: string;
  productId: string;
  title: string;
  variantTitle: string;
  sku: string | null;
  url: string | null;
};
type Mapping = {
  id: string;
  name: string;
  category: string | null;
  active: boolean;
  storeA: Variant;
  storeB: Variant;
  status: "matching" | "different" | "missing" | "conflict" | "error" | "sync-error" | "waiting" | "inactive";
  canResolve: boolean;
  error: string | null;
  checkedAt: string | null;
};
type Snapshot = {
  configured: boolean;
  error?: string | null;
  checkedAt: string | null;
  lastAutomaticCheckAt: string | null;
  mappings: Mapping[];
  busy?: boolean;
};
type Choice = { mapping: Mapping; source: Store };
type Notice = { kind: "success" | "error"; text: string };

const storeNames: Record<Store, string> = { A: "Corals Anonymous", B: "Macroalgae Farms" };
const statusNames: Record<Mapping["status"], string> = {
  matching: "Matching",
  different: "Different SKUs",
  missing: "Missing SKU",
  conflict: "Choose a SKU",
  error: "Could not check",
  "sync-error": "Needs attention",
  waiting: "Waiting to check",
  inactive: "Inactive",
};

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function readSnapshot(response: Response): Promise<Snapshot> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RequestError(
      typeof body?.error === "string" ? body.error : "SKU Sync could not complete the request. Please try again.",
      response.status,
    );
  }
  if (!body || typeof body.configured !== "boolean" || !Array.isArray(body.mappings) ||
      !(body.lastAutomaticCheckAt === null || typeof body.lastAutomaticCheckAt === "string")) {
    throw new Error("SKU Sync returned an unexpected response. Please refresh and try again.");
  }
  return body as Snapshot;
}

function variantFor(mapping: Mapping, store: Store) {
  return store === "A" ? mapping.storeA : mapping.storeB;
}

function skuLabel(value: string | null) {
  return value === null ? "Unavailable" : value === "" ? "No SKU" : value;
}

function checkTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function checkedLabel(value: string | null, comparison = false) {
  const time = checkTime(value);
  return time ? `${comparison ? "Comparison checked" : "Checked"} ${time}` : comparison ? "Comparison not checked yet" : "Not checked yet";
}

function isFreshSnapshot(snapshot: Snapshot) {
  return snapshot.configured && !snapshot.error && !snapshot.busy;
}

function productUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export default function SkuSyncWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const requestSequence = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const choiceButton = useRef<HTMLButtonElement | null>(null);

  const refresh = useCallback(async (clearNotice = true, signal?: AbortSignal) => {
    const request = ++requestSequence.current;
    setLoading(true);
    if (clearNotice) setNotice(null);
    try {
      const data = await readSnapshot(await fetch("/api/sku-sync", { cache: "no-store", signal }));
      if (signal?.aborted || request !== requestSequence.current) return false;
      setSnapshot(data);
      const isFresh = isFreshSnapshot(data);
      setFresh(isFresh);
      return isFresh;
    } catch (error) {
      if (signal?.aborted || request !== requestSequence.current) return false;
      setFresh(false);
      if (clearNotice) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not load SKU Sync." });
      return false;
    } finally {
      if (!signal?.aborted && request === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // The initial browser request loads this workspace without server-side data access.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(true, controller.signal);
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (choice && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
      cancelButton.current?.focus();
    } else if (!choice) {
      if (dialog.current?.open) dialog.current.close();
      if (!saving) choiceButton.current?.focus();
    }
  }, [choice, saving]);

  const mappings = useMemo(() => snapshot?.mappings ?? [], [snapshot]);
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return mappings;
    return mappings.filter(mapping => [
      mapping.name, mapping.category,
      mapping.storeA.title, mapping.storeA.variantTitle, mapping.storeA.sku,
      mapping.storeB.title, mapping.storeB.variantTitle, mapping.storeB.sku,
    ].some(value => value?.toLocaleLowerCase().includes(search)));
  }, [mappings, query]);
  const matching = mappings.filter(mapping => mapping.active && mapping.status === "matching").length;
  const needsAttention = mappings.filter(mapping => mapping.active && mapping.status === "sync-error").length;
  const blocked = loading || saving !== null || !fresh || !snapshot?.configured || snapshot.busy === true;

  function choose(mapping: Mapping, source: Store, button: HTMLButtonElement) {
    if (blocked || !mapping.active || !mapping.canResolve || mapping.status === "matching" ||
        typeof mapping.storeA.sku !== "string" || typeof mapping.storeB.sku !== "string") return;
    choiceButton.current = button;
    setChoice({ mapping, source });
  }

  async function confirmChoice() {
    if (!choice || blocked) return;
    const { mapping, source } = choice;
    const expectedSkuA = mapping.storeA.sku;
    const expectedSkuB = mapping.storeB.sku;
    if (typeof expectedSkuA !== "string" || typeof expectedSkuB !== "string") return;
    const target: Store = source === "A" ? "B" : "A";
    const selectedSku = variantFor(mapping, source).sku;
    setSaving(mapping.id);
    setNotice(null);
    try {
      const data = await readSnapshot(await fetch("/api/sku-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mappingId: mapping.id, source, expectedSkuA, expectedSkuB,
          expectedVariantAId: mapping.storeA.variantId,
          expectedVariantBId: mapping.storeB.variantId,
        }),
      }));
      setSnapshot(data);
      setFresh(isFreshSnapshot(data));
      setChoice(null);
      setNotice({ kind: "success", text: selectedSku === ""
        ? `Cleared the SKU in ${storeNames[target]} for ${mapping.name}. Both products now have no SKU.`
        : `Applied the ${storeNames[source]} SKU to ${storeNames[target]} for ${mapping.name}.` });
    } catch (error) {
      setChoice(null);
      setFresh(false);
      const reloaded = await refresh(false);
      const message = error instanceof Error ? error.message : "Could not confirm the SKU change.";
      setNotice({ kind: "error", text: `${message}${error instanceof RequestError && error.status === 409 && reloaded
        ? " The latest SKUs are shown below. Review them before choosing again."
        : reloaded ? " The latest SKUs are shown below; check them before trying again."
          : " Refresh to check the latest SKUs before trying again."}` });
    } finally {
      setSaving(null);
    }
  }

  const selectedVariant = choice ? variantFor(choice.mapping, choice.source) : null;
  const targetStore: Store | null = choice ? (choice.source === "A" ? "B" : "A") : null;
  const targetVariant = choice && targetStore ? variantFor(choice.mapping, targetStore) : null;
  const automaticAt = snapshot?.lastAutomaticCheckAt;
  const automaticTime = checkTime(automaticAt ?? null);

  return <div className="page-stack sku-sync">
    <header className="sku-sync__heading">
      <div>
        <p className="page-header-eyebrow">Inventory &amp; demand</p>
        <h1 className="page-title">SKU Sync</h1>
        <p className="page-description">Compare linked products in Corals Anonymous and Macroalgae Farms. If needed, choose which SKU to keep.</p>
      </div>
      <div className="sku-sync__refresh-control">
        <button className="button button-secondary sku-sync__refresh" type="button" disabled={loading || saving !== null}
          aria-describedby="sku-sync-refresh-help" onClick={() => void refresh()}><ReefIcon name="rotation" size={17} />{loading ? "Refreshing…" : "Refresh"}</button>
        <small id="sku-sync-refresh-help">Reloads comparison only.</small>
      </div>
    </header>

    <div className="sku-sync__automatic">
      <p className="sku-sync__automatic-time">{automaticTime && automaticAt
        ? <>Last automatic check: <time dateTime={automaticAt}>{automaticTime}</time></>
        : automaticAt === null ? "No automatic check yet"
          : loading ? "Loading automatic-check status…" : "Automatic-check status unavailable"}</p>
      <p className="sku-sync__explanation">Checks automatically about every 5 minutes. Existing differences stay unchanged until you choose a SKU or one changes. Stock quantities are not changed by SKU Sync.</p>
    </div>

    {notice && <div className={`sku-sync__notice sku-sync__notice--${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</div>}
    {snapshot?.error && <div className="sku-sync__notice sku-sync__notice--error" role="alert">{snapshot.error}</div>}
    {snapshot?.busy && <p className="sku-sync__notice" role="status">A sync check is in progress. Refresh shortly to see the latest SKUs.</p>}

    {snapshot && !snapshot.configured ? <section className="sku-sync__empty card">
      <h2>SKU Sync is not connected yet</h2>
      <p>The inventory-sync connection needs to be configured before product pairs can appear here.</p>
    </section> : <section className="sku-sync__panel" aria-label="Linked product SKUs" aria-busy={loading}>
      <div className="sku-sync__toolbar">
        <div className="sku-sync__summary">
          <strong>{mappings.length} {mappings.length === 1 ? "product pair" : "product pairs"}</strong>
          <span>{matching} matching{needsAttention > 0 && <> · <span className="sku-sync__attention-count">{needsAttention} {needsAttention === 1 ? "needs" : "need"} attention</span></>}</span>
        </div>
        <label className="sku-sync__search"><span>Search products or SKUs</span>
          <input type="search" placeholder="Product name or SKU" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
      </div>
      <div className="sku-sync__list-meta"><span>{query.trim() ? `${visible.length} of ${mappings.length} pairs` : "Linked through your inventory mappings"}</span><span>{checkedLabel(snapshot?.checkedAt ?? null, true)}</span></div>

      {loading && !snapshot ? <p className="sku-sync__empty" role="status">Loading product pairs…</p>
        : !snapshot ? <div className="sku-sync__empty"><h2>Could not load product pairs</h2><p>Use Refresh to try again.</p></div>
          : !mappings.length ? <div className="sku-sync__empty"><h2>No linked products yet</h2><p>New inventory mappings appear here automatically on the next check.</p></div>
            : !visible.length ? <div className="sku-sync__empty"><h2>No matching product pairs</h2><p>Try another product name or SKU.</p></div>
              : <div className="sku-sync__rows">{visible.map(mapping => <article className={`sku-sync__pair${!mapping.active ? " sku-sync__pair--inactive" : ""}`} key={mapping.id}>
                <header className="sku-sync__pair-heading"><div><h2>{mapping.name}</h2>{mapping.category && <span className="sku-sync__category">{mapping.category}</span>}</div>
                  <span className={`sku-sync__badge sku-sync__badge--${mapping.status}`}>{statusNames[mapping.status]}</span>
                </header>
                <div className="sku-sync__stores">{(["A", "B"] as const).map(store => {
                  const variant = variantFor(mapping, store);
                  const url = productUrl(variant.url);
                  const canChoose = mapping.active && mapping.canResolve && mapping.status !== "matching" && typeof mapping.storeA.sku === "string" && typeof mapping.storeB.sku === "string";
                  return <section className="sku-sync__store" key={store} aria-label={`${mapping.name} in ${storeNames[store]}`}>
                    <p className="sku-sync__store-name">{storeNames[store]}</p>
                    <div className="sku-sync__product">{url ? <a href={url} target="_blank" rel="noopener noreferrer">{variant.title || "Product unavailable"}<span aria-hidden="true"> ↗</span></a> : <strong>{variant.title || "Product unavailable"}</strong>}
                      {variant.variantTitle && variant.variantTitle !== "Default Title" && <small>{variant.variantTitle}</small>}
                    </div>
                    <div className={`sku-sync__value${variant.sku === "" || variant.sku === null ? " sku-sync__value--empty" : ""}`}><span>SKU</span><code>{skuLabel(variant.sku)}</code></div>
                    {mapping.status !== "matching" && mapping.active && <button className="button button-secondary sku-sync__choose" type="button" disabled={blocked || !canChoose}
                      aria-label={`Use ${storeNames[store]} SKU for ${mapping.name}`}
                      onClick={event => choose(mapping, store, event.currentTarget)}>Use this SKU<ReefIcon name="arrow" size={16} /></button>}
                  </section>;
                })}</div>
                {(mapping.error || mapping.status === "sync-error" || mapping.status === "conflict" || !mapping.active) && <p className={`sku-sync__pair-note${mapping.status === "sync-error" ? " sku-sync__pair-note--attention" : ""}`}>
                  {!mapping.active ? "This inventory mapping is inactive. SKU syncing is paused for this pair." : mapping.error || (mapping.status === "sync-error" ? "The SKU update could not be completed." : "Both SKUs changed. Choose which SKU to keep.")}
                  {mapping.active && mapping.status === "sync-error" && !mapping.error && <span className="sku-sync__pair-action-note">{mapping.canResolve ? "Review both SKUs and choose which one to keep." : "Refresh the comparison to check this pair again."}</span>}
                </p>}
                <p className="sku-sync__pair-checked">{checkedLabel(mapping.checkedAt)}</p>
              </article>)}</div>}
    </section>}

    <dialog ref={dialog} className="sku-sync__confirm" aria-labelledby="sku-sync-confirm-title" aria-describedby="sku-sync-confirm-description"
      onCancel={event => { event.preventDefault(); if (!saving) setChoice(null); }}>
      {choice && selectedVariant && targetStore && targetVariant && <>
        <p className="sku-sync__confirm-eyebrow">Confirm SKU change</p>
        <h2 id="sku-sync-confirm-title">{selectedVariant.sku === "" ? `Clear the SKU in ${storeNames[targetStore]}?` : `Use the ${storeNames[choice.source]} SKU?`}</h2>
        <p id="sku-sync-confirm-description">{selectedVariant.sku === ""
          ? `This will clear the SKU in ${storeNames[targetStore]} for ${choice.mapping.name}. Both products will have no SKU.`
          : `This will replace the SKU in ${storeNames[targetStore]} for ${choice.mapping.name}. The ${storeNames[choice.source]} SKU stays unchanged.`}</p>
        <dl className="sku-sync__change"><div><dt>Current SKU in {storeNames[targetStore]}</dt><dd>{skuLabel(targetVariant.sku)}</dd></div><div><dt>Replace with</dt><dd>{skuLabel(selectedVariant.sku)}</dd></div></dl>
        <p className="sku-sync__confirm-note">Stock quantities will not change.</p>
        <footer><button ref={cancelButton} type="button" className="button button-secondary" disabled={saving !== null} onClick={() => setChoice(null)}>Cancel</button>
          <button type="button" className="button button-primary" disabled={saving !== null} onClick={() => void confirmChoice()}>{saving ? "Updating…" : selectedVariant.sku === "" ? "Clear SKU" : "Confirm SKU change"}</button></footer>
      </>}
    </dialog>
  </div>;
}
