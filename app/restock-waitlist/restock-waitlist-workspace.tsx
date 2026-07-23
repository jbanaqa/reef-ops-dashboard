"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "./restock-waitlist.module.css";

type RowAction = (formData:FormData) => Promise<void>;
type Entry = { id:string; shop:string; productId:string; productHandle:string|null; productTitle:string|null; email:string; status:string; subscribedAt:string; notifiedAt:string|null };
type State = { filter:string; query:string; sort:string; dir:string; page:number; pageSize:number; pageCount:number; filteredCount:number };
type Props = {
  entries:Entry[];
  counts:Record<"all"|"waiting"|"notified"|"handled"|"canceled",number>;
  state:State;
  message:{ type:string; text:string }|null;
  sendAction:RowAction;
  handledAction:RowAction;
  deleteAction:RowAction;
};
type ConfirmState = { kind:"send"|"handled"|"delete"; entry:Entry }|null;

const FILTERS = [
  ["waiting","Waiting"],["notified","Notified"],["handled","Handled"],["canceled","Canceled"],["all","All records"],
] as const;

function displayStatus(status:string) { return status === "Unsubscribed" ? "Canceled" : status; }
function exactDate(value:string|null) {
  if (!value) return "Not notified";
  return new Intl.DateTimeFormat("en-US",{ month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/Los_Angeles",timeZoneName:"short" }).format(new Date(value));
}
function friendlyDate(value:string|null) {
  if (!value) return "—";
  const date = new Date(value);
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US",{ timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit" });
  const [today, target] = [now,date].map((item) => formatter.format(item));
  const yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
  const label = target === today ? "Today" : target === formatter.format(yesterday) ? "Yesterday" : new Intl.DateTimeFormat("en-US",{ month:"short",day:"numeric",year:date.getFullYear() === now.getFullYear() ? undefined:"numeric",timeZone:"America/Los_Angeles" }).format(date);
  const time = new Intl.DateTimeFormat("en-US",{ hour:"numeric",minute:"2-digit",timeZone:"America/Los_Angeles" }).format(date);
  return `${label}, ${time}`;
}
function storeProductUrl(entry:Entry) { return entry.productHandle ? `https://${entry.shop}/products/${entry.productHandle}` : null; }

function SortMark({ active, dir }:{ active:boolean; dir:string }) { return <span className={styles.sortMark} aria-hidden="true">{active ? dir === "asc" ? "↑" : "↓" : "↕"}</span>; }

export function RestockWaitlistWorkspace({ entries, counts, state, message, sendAction, handledAction, deleteAction }:Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedIds,setSelectedIds] = useState<Set<string>>(new Set());
  const [query,setQuery] = useState(state.query);
  const [confirm,setConfirm] = useState<ConfirmState>(null);
  const [copied,setCopied] = useState<string|null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selected = entries.filter((entry) => selectedIds.has(entry.id));
  const waitingSelected = selected.filter((entry) => entry.status === "Waiting");
  const allSelected = entries.length > 0 && selectedIds.size === entries.length;
  const partiallySelected = selectedIds.size > 0 && !allSelected;
  const from = state.filteredCount ? (state.page - 1) * state.pageSize + 1 : 0;
  const to = Math.min(state.page * state.pageSize,state.filteredCount);
  const returnTo = `${pathname}?${searchParams.toString()}`;

  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = partiallySelected; },[partiallySelected]);

  function navigate(updates:Record<string,string|number|undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("message"); params.delete("result");
    for (const [key,value] of Object.entries(updates)) {
      if (value === undefined || value === "") params.delete(key);
      else params.set(key,String(value));
    }
    router.push(`${pathname}?${params.toString()}`,{ scroll:false });
  }
  function sortBy(column:string) { navigate({ sort:column,dir:state.sort === column && state.dir === "desc" ? "asc":"desc",page:1 }); }
  function toggle(id:string) { setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function copyEmail(entry:Entry) { navigator.clipboard.writeText(entry.email).then(() => { setCopied(entry.id); window.setTimeout(() => setCopied(null),1600); }); }
  function submitSearch(event:React.FormEvent) { event.preventDefault(); navigate({ q:query.trim() || undefined,page:1 }); }
  const modalCopy = useMemo(() => {
    if (!confirm) return null;
    if (confirm.kind === "send") return { eyebrow:"Manual notification",title:"Send restock email?",body:`Reef Ops will email ${confirm.entry.email} about ${confirm.entry.productTitle || "this product"} and mark this request Notified.`,button:"Send restock email",tone:"primary" };
    if (confirm.kind === "handled") return { eyebrow:"Complete without email",title:"Mark this request handled?",body:"This removes the request from the active queue and prevents its automatic restock email. No email will be sent now.",button:"Mark handled",tone:"gold" };
    return { eyebrow:"Permanent action",title:"Delete this record?",body:"This removes the waitlist history permanently. This cannot be undone.",button:"Delete record",tone:"danger" };
  },[confirm]);

  return <section className={styles.workspace}>
    <header className={styles.workspaceHeader}>
      <div><p className={styles.sectionKicker}>Customer follow-up</p><h2>{state.filter === "all" ? "All waitlist records" : `${FILTERS.find(([key]) => key === state.filter)?.[1]} requests`}</h2><p>Search, review, print, and complete customer requests from one focused queue.</p></div>
      <div className={styles.resultPill}><i/><strong>{state.filteredCount}</strong><span>{state.filteredCount === 1 ? "result":"results"}</span></div>
    </header>

    {message ? <div className={`${styles.notice} ${message.type === "success" ? styles.noticeSuccess : styles.noticeError}`} role="status" aria-live="polite"><span>{message.type === "success" ? "✓":"!"}</span><p>{message.text}</p><button type="button" onClick={() => navigate({})} aria-label="Dismiss message">×</button></div> : <div className={styles.srStatus} role="status" aria-live="polite">{selectedIds.size} rows selected</div>}

    <nav className={styles.filters} aria-label="Filter waitlist by status">
      {FILTERS.map(([key,label]) => <button key={key} type="button" className={state.filter === key ? styles.filterActive : ""} onClick={() => navigate({ filter:key,page:1 })}><span>{label}</span><strong>{counts[key]}</strong></button>)}
    </nav>

    <div className={styles.toolbar}>
      <form className={styles.search} onSubmit={submitSearch} role="search"><span aria-hidden="true">⌕</span><label className={styles.srOnly} htmlFor="waitlist-search">Search waitlist</label><input id="waitlist-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product or customer email…"/><button type="submit">Search</button>{state.query ? <button type="button" className={styles.clearSearch} onClick={() => { setQuery(""); navigate({ q:undefined,page:1 }); }}>Clear</button> : null}</form>
      <div className={styles.pageSize}><label htmlFor="waitlist-page-size">Rows</label><select id="waitlist-page-size" value={state.pageSize} onChange={(event) => navigate({ pageSize:event.target.value,page:1 })}><option>25</option><option>50</option><option>100</option></select></div>
    </div>

    <div className={`${styles.batchBar} ${selectedIds.size ? styles.batchBarActive : ""}`} aria-hidden={!selectedIds.size}>
      <div className={styles.batchCount}><span>{selectedIds.size}</span><div><strong>Selected on this page</strong><small>Ready for a focused customer-service handoff</small></div></div>
      <div className={styles.batchActions}>
        {waitingSelected.length ? <form action={handledAction} onSubmit={(event) => { if (!window.confirm(`Mark ${waitingSelected.length} selected waiting ${waitingSelected.length === 1 ? "request":"requests"} handled? No email will be sent.`)) event.preventDefault(); }}><input type="hidden" name="entryIds" value={waitingSelected.map((entry) => entry.id).join(",")}/><input type="hidden" name="returnTo" value={returnTo}/><button className={styles.batchSecondary}>◇ Mark handled</button></form> : null}
        <button type="button" className={styles.batchPrimary} onClick={() => window.print()}>▤ Print selected sheet</button>
        <button type="button" className={styles.batchClear} onClick={() => setSelectedIds(new Set())}>Clear selection</button>
      </div>
    </div>

    <div className={styles.tableScroller} tabIndex={0} aria-label="Scrollable restock waitlist table">
      <table className={styles.table}>
        <caption>Restock waitlist customer requests. Current view: {state.filter}. Showing {from} through {to} of {state.filteredCount}.</caption>
        <thead><tr>
          <th scope="col" className={styles.checkCell}><input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? new Set() : new Set(entries.map((entry) => entry.id)))} aria-label={allSelected ? "Clear all rows on this page":"Select all rows on this page"}/></th>
          <th scope="col"><button onClick={() => sortBy("productTitle")}>Product <SortMark active={state.sort === "productTitle"} dir={state.dir}/></button></th>
          <th scope="col"><button onClick={() => sortBy("email")}>Customer <SortMark active={state.sort === "email"} dir={state.dir}/></button></th>
          <th scope="col"><button onClick={() => sortBy("status")}>Status <SortMark active={state.sort === "status"} dir={state.dir}/></button></th>
          <th scope="col"><button onClick={() => sortBy("subscribedAt")}>Signed up <SortMark active={state.sort === "subscribedAt"} dir={state.dir}/></button></th>
          <th scope="col"><button onClick={() => sortBy("notifiedAt")}>Notified <SortMark active={state.sort === "notifiedAt"} dir={state.dir}/></button></th>
          <th scope="col" className={styles.actionsHeading}>Actions</th>
        </tr></thead>
        <tbody>{entries.map((entry,index) => { const isSelected = selectedIds.has(entry.id); const productUrl = storeProductUrl(entry); return <tr key={entry.id} className={isSelected ? styles.selectedRow : ""} style={{ "--row-index":index } as React.CSSProperties}>
          <td className={styles.checkCell}><input type="checkbox" checked={isSelected} onChange={() => toggle(entry.id)} aria-label={`Select ${entry.productTitle || "untitled product"}`}/></td>
          <th scope="row" className={styles.productCell}><div>{productUrl ? <a href={productUrl} target="_blank" rel="noreferrer">{entry.productTitle || "Untitled product"}<span aria-hidden="true">↗</span></a> : <strong>{entry.productTitle || "Untitled product"}</strong>}<small>{entry.productHandle ? entry.productHandle.replaceAll("-"," "):entry.productId}</small></div></th>
          <td className={styles.emailCell}><div><a href={`mailto:${entry.email}`}>{entry.email}</a><button type="button" onClick={() => copyEmail(entry)} aria-label={`Copy ${entry.email}`}>{copied === entry.id ? "Copied!":"Copy"}</button></div></td>
          <td><span className={`${styles.status} ${styles[`status${displayStatus(entry.status)}`]}`}><i/>{displayStatus(entry.status)}</span></td>
          <td className={styles.dateCell}><time dateTime={entry.subscribedAt} title={exactDate(entry.subscribedAt)}>{friendlyDate(entry.subscribedAt)}</time></td>
          <td className={styles.dateCell}>{entry.notifiedAt ? <time dateTime={entry.notifiedAt} title={exactDate(entry.notifiedAt)}>{friendlyDate(entry.notifiedAt)}</time> : <span className={styles.emptyDate}>—</span>}</td>
          <td className={styles.rowActions}>{entry.status === "Waiting" ? <button type="button" className={styles.sendButton} onClick={() => setConfirm({ kind:"send",entry })}>Send email</button> : <span className={styles.completedLabel}>{entry.status === "Notified" ? "Email sent":"Complete"}</span>}<details className={styles.more}><summary aria-label={`More actions for ${entry.productTitle || "product"}`}>•••</summary><div>{entry.status === "Waiting" ? <button type="button" onClick={() => setConfirm({ kind:"handled",entry })}>Mark handled</button> : null}<button type="button" className={styles.deleteAction} onClick={() => setConfirm({ kind:"delete",entry })}>Delete record</button></div></details></td>
        </tr> })}</tbody>
      </table>
      {!entries.length ? <div className={styles.empty}><div>⌕</div><h3>No matching requests</h3><p>Try another status or clear your search to see more waitlist records.</p><button type="button" onClick={() => { setQuery(""); navigate({ q:undefined,filter:"waiting",page:1 }); }}>Return to waiting queue</button></div> : null}
    </div>

    <footer className={styles.pagination}><p>Showing <strong>{from}–{to}</strong> of <strong>{state.filteredCount}</strong></p><nav aria-label="Waitlist pages"><button type="button" onClick={() => navigate({ page:state.page-1 })} disabled={state.page <= 1}>← Previous</button><span>Page <strong>{state.page}</strong> of {state.pageCount}</span><button type="button" onClick={() => navigate({ page:state.page+1 })} disabled={state.page >= state.pageCount}>Next →</button></nav></footer>

    <section className={styles.printSheet} aria-hidden="true"><header><div><p>Corals Anonymous · Reef Ops</p><h1>Restock Follow-up</h1></div><aside><strong>{selected.length}</strong><span>{selected.length === 1 ? "customer":"customers"}</span></aside></header><p className={styles.printNote}>Customer service handoff · Check each request after it has been handled.</p><table><thead><tr><th>Done</th><th>Item / Product</th><th>Customer Email</th><th>Signup Date &amp; Time</th></tr></thead><tbody>{selected.map((entry) => <tr key={entry.id}><td><span/></td><td>{entry.productTitle || "Untitled product"}</td><td>{entry.email}</td><td>{exactDate(entry.subscribedAt)}</td></tr>)}</tbody></table><footer>Printed from Reef Ops · Selected entries only · Pacific Time</footer></section>

    {confirm && modalCopy ? <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirm(null); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="waitlist-confirm-title"><button type="button" className={styles.modalClose} onClick={() => setConfirm(null)} aria-label="Close">×</button><p>{modalCopy.eyebrow}</p><h3 id="waitlist-confirm-title">{modalCopy.title}</h3><div className={styles.modalProduct}><span>{(confirm.entry.productTitle || "?").slice(0,1)}</span><div><strong>{confirm.entry.productTitle || "Untitled product"}</strong><small>{confirm.entry.email}</small></div></div><p className={styles.modalBody}>{modalCopy.body}</p><div className={styles.modalActions}><button type="button" onClick={() => setConfirm(null)}>Cancel</button><form action={confirm.kind === "send" ? sendAction : confirm.kind === "handled" ? handledAction : deleteAction}><input type="hidden" name="entryId" value={confirm.entry.id}/><input type="hidden" name="returnTo" value={returnTo}/><button className={styles[`modal${modalCopy.tone[0].toUpperCase()+modalCopy.tone.slice(1)}`]}>{modalCopy.button}</button></form></div></section></div> : null}
  </section>;
}
