"use client";

import { useState } from "react";
import { RestockWaitlistRowActions } from "./row-actions";

type RowAction = (formData: FormData) => Promise<void>;
type WaitlistEntry = { id:string; productId:string; productHandle:string|null; productTitle:string|null; email:string; status:string; subscribedLabel:string; notifiedLabel:string };
type Props = { entries:WaitlistEntry[]; sendAction:RowAction; deleteAction:RowAction };

export function PrintableWaitlist({ entries, sendAction, deleteAction }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selected = entries.filter((entry) => selectedIds.has(entry.id));
  const allSelected = entries.length > 0 && selectedIds.size === entries.length;
  const toggle = (id:string) => setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <>
    <div className="waitlist-selection-bar">
      <div><strong>{selectedIds.size} selected</strong><span>Choose only the entries customer service should handle.</span></div>
      <div className="waitlist-selection-actions">
        <button type="button" className="button button-secondary" onClick={() => setSelectedIds(new Set(entries.map((entry) => entry.id)))} disabled={allSelected}>Select all</button>
        <button type="button" className="button button-secondary" onClick={() => setSelectedIds(new Set())} disabled={!selectedIds.size}>Clear</button>
        <button type="button" className="button button-primary" onClick={() => window.print()} disabled={!selectedIds.size}>Print selected sheet</button>
      </div>
    </div>
    <div className="feedback-table-wrap waitlist-screen-table"><table className="feedback-table">
      <thead><tr><th className="waitlist-check-column"><input type="checkbox" className="waitlist-checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? new Set() : new Set(entries.map((entry) => entry.id)))} aria-label={allSelected ? "Clear all entries" : "Select all entries"}/></th><th>Product</th><th>Email</th><th>Status</th><th>Subscribed</th><th>Notified</th><th>Actions</th></tr></thead>
      <tbody>{entries.map((entry) => { const isSelected = selectedIds.has(entry.id); return <tr key={entry.id} className={isSelected ? "waitlist-row-selected" : undefined}>
        <td className="waitlist-check-column"><input type="checkbox" className="waitlist-checkbox" checked={isSelected} onChange={() => toggle(entry.id)} aria-label={`Select ${entry.productTitle || "untitled product"} for printing`}/></td>
        <td className="feedback-summary-cell"><p className="feedback-summary">{entry.productTitle || "Untitled product"}</p><p className="feedback-original-preview">{entry.productHandle ? `/${entry.productHandle}` : entry.productId}</p></td>
        <td>{entry.email}</td><td><span className="badge badge-status">{entry.status}</span></td><td>{entry.subscribedLabel}</td><td>{entry.notifiedLabel}</td>
        <td><RestockWaitlistRowActions entryId={entry.id} status={entry.status} sendAction={sendAction} deleteAction={deleteAction}/></td>
      </tr>})}</tbody>
    </table></div>
    <section className="waitlist-print-sheet" aria-hidden="true">
      <header className="waitlist-print-header"><div><p>Corals Anonymous · Reef Ops</p><h1>Restock Waitlist</h1></div><div className="waitlist-print-count"><strong>{selected.length}</strong><span>{selected.length === 1 ? "customer" : "customers"}</span></div></header>
      <p className="waitlist-print-instructions">Customer service follow-up sheet · Check off each entry after it is handled.</p>
      <table><thead><tr><th className="waitlist-print-done">Done</th><th>Item / Product</th><th>Customer Email</th><th>Signup Date &amp; Time</th></tr></thead><tbody>{selected.map((entry) => <tr key={entry.id}><td className="waitlist-print-done"><span/></td><td>{entry.productTitle || "Untitled product"}</td><td>{entry.email}</td><td>{entry.subscribedLabel}</td></tr>)}</tbody></table>
      <footer>Printed from Reef Ops · Selected entries only</footer>
    </section>
  </>;
}
