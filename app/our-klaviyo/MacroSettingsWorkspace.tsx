"use client";

import { useEffect, useState } from "react";
import type { SettingsData } from "./SettingsWorkspace";
import SenderIdentity from "./SenderIdentity";
import { useMarketingAction, useMarketingBrand, useMarketingRequest, useMarketingUnsavedChanges } from "./MarketingBrand";

type SubscriberSync = {
  configured: boolean; running: boolean; phase: "not-started" | "customers" | "complete";
  checked: number; imported: number; updated: number; suppressed: number; skipped: number; errors: number;
  lastBatchAt?: string; startedAt?: string; completedAt?: string; error?: string;
  issues: { customerId: string; email?: string; error: string }[];
};
const when = (value?: string) => value ? new Date(value).toLocaleString() : "Not run yet";

export default function MacroSettingsWorkspace({ data, refresh }: { data: SettingsData; refresh: () => Promise<void> }) {
  const { brand, href } = useMarketingBrand();
  const request = useMarketingRequest(), action = useMarketingAction();
  const [subscribers, setSubscribers] = useState<SubscriberSync | null>(null);
  const [savedBusiness, setSavedBusiness] = useState({ organizationName: data.settings.organizationName, postalAddress: data.settings.postalAddress });
  const [business, setBusiness] = useState(savedBusiness);
  const [savedControls, setSavedControls] = useState({ sendingEnabled: data.settings.operations.sendingEnabled, migrationConfirmed: data.settings.operations.migrationConfirmed, ingestEnabled: data.settings.operations.ingestEnabled });
  const [controls, setControls] = useState(savedControls);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirtyBusiness = JSON.stringify(business) !== JSON.stringify(savedBusiness);
  const dirtyControls = JSON.stringify(controls) !== JSON.stringify(savedControls);
  useMarketingUnsavedChanges(dirtyBusiness || dirtyControls);
  useEffect(() => {
    let active = true;
    const load = () => request<SubscriberSync>("/api/marketing?view=shopify-subscribers")
      .then((result) => { if (active) setSubscribers(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load subscriber sync."); });
    void load();
    const timer = window.setInterval(() => { if (active) void load(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [request]);
  async function run(key: string, task: () => Promise<void>, message: string) {
    setBusy(key); setError(""); setNotice("");
    try { await task(); setNotice(message); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this change."); }
    finally { setBusy(""); }
  }
  return <div className="sw-workspace sw-brand-settings"><div className="sw-content">
    {error && <p role="alert" className="sw-alert">{error}</p>}
    {notice && <p role="status" className="sw-notice">{notice}</p>}
    <div className="sw-heading"><div><p className="sw-eyebrow">MACROALGAE FARMS SETTINGS</p><h2>Campaign setup</h2><p>Manage this store’s subscribers, sender, and campaign sending.</p></div></div>
    <section className="sw-card">
      <h3>Shopify email subscribers</h3>
      <p>Sync email consent from {brand.storefrontOrigin.replace("https://", "")}. Only subscribed customers enter this brand’s marketing audience; unsubscribes and blocked addresses stay excluded. No messages are sent by this sync.</p>
      {!subscribers ? <p>Checking the Shopify connection…</p> : <>
        <dl className="sw-backfill-stats"><div><dt>Status</dt><dd>{subscribers.running ? "Syncing in the background" : subscribers.phase === "complete" ? "Sync complete" : subscribers.phase === "not-started" ? "Not started" : "Paused"}</dd></div><div><dt>Customers checked</dt><dd>{subscribers.checked.toLocaleString()}</dd></div><div><dt>Added</dt><dd>{subscribers.imported.toLocaleString()}</dd></div><div><dt>Updated</dt><dd>{subscribers.updated.toLocaleString()}</dd></div><div><dt>Suppressed</dt><dd>{subscribers.suppressed.toLocaleString()}</dd></div><div><dt>Needs review</dt><dd>{subscribers.errors.toLocaleString()}</dd></div></dl>
        <p className="sw-hint">Last update: {when(subscribers.lastBatchAt || subscribers.completedAt)}. You can leave this page while syncing.</p>
        {subscribers.error && <p className="sw-warning">{subscribers.error}</p>}
        {!subscribers.configured && <p className="sw-warning">Connect the Macroalgae Farms Shopify store before syncing.</p>}
        <div className="sw-import-actions"><button disabled={!!busy || !subscribers.configured} className="sw-primary" onClick={() => void run("sync", async () => {
          setSubscribers(await action<SubscriberSync>({ action: subscribers.running ? "pause-shopify-subscribers" : "sync-shopify-subscribers" }));
        }, subscribers.running ? "Subscriber sync paused." : "Subscriber sync queued. It will continue in the background.")}>{busy === "sync" ? "Updating…" : subscribers.running ? "Pause sync" : subscribers.phase === "customers" ? "Continue sync" : "Sync Shopify subscribers"}</button><a href={href("/our-klaviyo/audiences")}>View subscribers →</a></div>
        {!!subscribers.issues?.length && <details><summary>Customers to review</summary>{subscribers.issues.map((issue, index) => <p key={`${issue.customerId}-${index}`}>{issue.email || issue.customerId}: {issue.error}</p>)}</details>}
      </>}
    </section>
    <section className="sw-card"><h3>Shopify orders and consent</h3><p>Connect this store’s order and consent events so campaign attribution and subscription changes stay up to date.</p>
      <button disabled={!!busy} onClick={() => void run("connect", async () => {
        await action({ action: "register-shopify-webhooks" });
      }, "Shopify connections checked. Existing matching connections were kept.")}>{busy === "connect" ? "Connecting…" : "Connect Shopify events"}</button>
      <label className="sw-toggle-row"><span><strong>Process Shopify orders and consent</strong><small>Keep purchase reporting and email consent current. This does not enable flows.</small></span><input type="checkbox" role="switch" checked={controls.ingestEnabled} onChange={(event) => setControls({ ...controls, ingestEnabled: event.target.checked })} disabled={!!busy} /></label>
      <p className="sw-hint">Save this preference with the sending preferences below.</p>
    </section>
    <SenderIdentity settings={data.settings} setup={data.setup} refresh={refresh} />
    <section className="sw-card"><h3>Business details</h3><p>These details appear in this brand’s email footer.</p>
      <form onSubmit={(event) => { event.preventDefault(); void run("business", async () => {
        const next = { organizationName: business.organizationName.trim(), postalAddress: business.postalAddress.trim() };
        await action({ action: "save-settings", settings: next }); setSavedBusiness(next); setBusiness(next);
      }, "Business details saved."); }}><fieldset disabled={!!busy}>
        <label>Business name<input required maxLength={120} value={business.organizationName} onChange={(event) => setBusiness({ ...business, organizationName: event.target.value })} /></label>
        <label>Business mailing address<textarea required rows={3} maxLength={500} value={business.postalAddress} onChange={(event) => setBusiness({ ...business, postalAddress: event.target.value })} placeholder="Street address, city, state, postal code, country" /></label>
        <div className="sw-save-row"><span>{dirtyBusiness ? "Unsaved business details" : "Business details saved"}</span><button className="sw-primary" disabled={!dirtyBusiness}>{busy === "business" ? "Saving…" : "Save business details"}</button></div>
      </fieldset></form>
    </section>
    <section className="sw-card"><h3>Customer campaign sending</h3><p>Drafts and internal previews are separate from customer sending. Flows and storefront signup forms are not active for Macroalgae Farms.</p>
      <label className="sw-toggle-row"><span><strong>Subscriber consent reviewed</strong><small>Confirm after reviewing Shopify subscribers and unsubscribe history.</small></span><input type="checkbox" role="switch" checked={controls.migrationConfirmed} onChange={(event) => setControls({ ...controls, migrationConfirmed: event.target.checked })} disabled={!!busy} /></label>
      <label className="sw-toggle-row"><span><strong>Allow customer campaign sending</strong><small>Allows eligible scheduled campaigns for Macroalgae Farms to send.</small></span><input type="checkbox" role="switch" checked={controls.sendingEnabled} onChange={(event) => setControls({ ...controls, sendingEnabled: event.target.checked })} disabled={!!busy} /></label>
      {!data.setup.emailReady && <p className="sw-warning">Complete this brand’s email setup before customer sending can run.</p>}
      <div className="sw-save-row"><span>{dirtyControls ? "Unsaved sending preferences" : savedControls.sendingEnabled ? "Customer campaign sending enabled" : "Customer campaign sending paused"}</span><button className="sw-primary" disabled={!!busy || !dirtyControls} onClick={() => {
        if (controls.sendingEnabled && !savedControls.sendingEnabled && !window.confirm("Enable customer campaign sending for Macroalgae Farms? Eligible scheduled campaigns may send on the next run.")) return;
        void run("sending", async () => { await action({ action: "save-settings", settings: { operations: controls } }); setSavedControls(controls); }, "Sending preferences saved.");
      }}>{busy === "sending" ? "Saving…" : "Save sending preferences"}</button></div>
    </section>
  </div></div>;
}
