"use client";

import { useState } from "react";
import type { MarketingSettings } from "@/lib/marketing/rules";
import { useMarketingAction, useMarketingBrand, useMarketingUnsavedChanges } from "./MarketingBrand";

export default function SenderIdentity({ settings, setup, refresh }: {
  settings: MarketingSettings;
  setup: Record<string, unknown>;
  refresh: () => Promise<void>;
}) {
  const { brand } = useMarketingBrand();
  const action = useMarketingAction();
  const [saved, setSaved] = useState(() => ({
    name: settings.sender?.name || String(setup.senderName || brand.name),
    email: settings.sender?.email || String(setup.senderEmail || ""),
    replyTo: settings.sender?.replyTo || "",
  }));
  const [sender, setSender] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = JSON.stringify(sender) !== JSON.stringify(saved);
  useMarketingUnsavedChanges(dirty);
  return <section className="sw-card">
    <h3>Email sender</h3>
    <p>Choose the name customers see in their inbox and where replies go for {brand.name}.</p>
    {error && <p role="alert" className="sw-alert">{error}</p>}
    {notice && <p role="status" className="sw-notice">{notice}</p>}
    <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(""); setNotice("");
      const next = { name: sender.name.trim(), email: sender.email.trim(), replyTo: sender.replyTo.trim() };
      try {
        await action({ action: "save-settings", settings: { sender: next } });
        setSaved(next); setSender(next); setNotice("Email sender saved."); await refresh();
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the email sender."); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}>
        <label>Sender name<input required maxLength={120} value={sender.name} onChange={(event) => setSender({ ...sender, name: event.target.value })} /></label>
        <label>From email<input type="email" required maxLength={254} value={sender.email} placeholder={`hello@${brand.storefrontOrigin.replace("https://", "")}`} onChange={(event) => setSender({ ...sender, email: event.target.value })} /></label>
        <label>Reply-to email (optional)<input type="email" maxLength={254} value={sender.replyTo} placeholder="Uses the From email when blank" onChange={(event) => setSender({ ...sender, replyTo: event.target.value })} /></label>
        <p className="sw-hint">The From domain must be verified in Resend. Saving an address does not verify the domain or enable customer sending.</p>
        <div className="sw-save-row"><span>{dirty ? "Unsaved sender details" : "Sender details saved"}</span><button disabled={!dirty || !sender.name.trim() || !sender.email.trim()} className="sw-primary">{busy ? "Saving…" : "Save email sender"}</button></div>
      </fieldset>
    </form>
  </section>;
}
