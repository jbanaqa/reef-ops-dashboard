"use client";

import { useState } from "react";
import { newsletterDefinition, newsletterSectionRemoved, type MacroNewsletter } from "@/lib/marketing/macro-newsletters";

export default function NewsletterSections({ newsletter, onChange }: { newsletter: MacroNewsletter; onChange: (hidden: string[]) => void }) {
  const sections = newsletterDefinition(newsletter.design).sections;
  const hidden = newsletter.hiddenSections || [];
  const [notice, setNotice] = useState("");
  const available = sections.filter(section => !section.parent || !newsletterSectionRemoved(newsletter, section.parent));
  const remove = (id: string, label: string) => {
    onChange([...new Set([...hidden, id])]);
    setNotice(`${label} removed. You can restore it below.`);
  };
  const restore = (id: string, label: string) => {
    onChange(hidden.filter(value => value !== id));
    setNotice(`${label} restored.`);
  };
  return <section className="mk-editor-section nl-section-manager" aria-label="Newsletter sections">
    <h3>Sections in this email</h3>
    <p>Remove a section to close its space in the email. Restore it with its text, pictures, and formatting whenever you need it.</p>
    <div className="nl-section-list">{available.filter(section => !hidden.includes(section.id)).map(section => <div key={section.id} className={`nl-section-row${section.parent ? " nl-section-child" : ""}`}>
      <span>{section.label}</span>
      <button type="button" aria-label={`Remove ${section.label} section`} onClick={() => remove(section.id, section.label)}>Remove</button>
    </div>)}</div>
    {!!hidden.length && <div className="nl-removed-sections">
      <h4>Removed sections</h4>
      {available.filter(section => hidden.includes(section.id)).map(section => <div key={section.id} className={`nl-section-row${section.parent ? " nl-section-child" : ""}`}>
        <span>{section.label}</span>
        <button type="button" aria-label={`Restore ${section.label} section`} onClick={() => restore(section.id, section.label)}>Restore</button>
      </div>)}
      <button type="button" className="nl-restore-all" onClick={() => { onChange([]); setNotice("All sections restored."); }}>Restore all sections</button>
    </div>}
    <p className="nl-section-note">The remaining sections keep their approved design and order. Subscription links stay in the footer.</p>
    <p className="nl-section-status" role="status" aria-live="polite">{notice}</p>
  </section>;
}
