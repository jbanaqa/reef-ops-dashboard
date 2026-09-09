import React from "react";
import { createRoot } from "react-dom/client";
import AudienceWorkspace from "../app/our-klaviyo/AudienceWorkspace";
createRoot(document.getElementById("root")!).render(
  <main className="marketing" style={{ padding: "24px", maxWidth: "1160px" }}>
    <header className="mk-header">
      <div>
        <p className="mk-eyebrow">CORALS ANONYMOUS / OUR KLAVIYO</p>
        <h1>Audiences</h1>
        <p>Your customers and the groups you reach.</p>
      </div>
      <span className="mk-status">Sending disabled</span>
    </header>
    <AudienceWorkspace sendingEnabled={false} />
  </main>,
);
