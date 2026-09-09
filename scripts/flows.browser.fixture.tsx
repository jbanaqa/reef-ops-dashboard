import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import FlowsWorkspace, {
  FlowResource,
} from "../app/our-klaviyo/FlowsWorkspace";
import {
  defaultContent,
  defaultMarketingSettings,
  flowDefaults,
} from "../lib/marketing/rules";
const initial: FlowResource[] = flowDefaults.map((f) => ({
  id: f.key,
  key: f.key,
  name: f.name,
  enabled: f.key === "b2b-welcome",
  data: {
    reviewed: f.key === "b2b-welcome",
    description: f.description,
    steps: f.delays.map((minutes) => ({
      minutes,
      subject: f.key === "b2b-welcome" ? "Welcome to wholesale" : f.name,
      channel: f.key === "low-stock" ? "SMS_TRANSACTIONAL" : "EMAIL",
      content: { ...defaultContent },
    })),
    ...(f.key === "abandoned-cart"
      ? {
          smsContent: defaultContent,
          smsMinutes: 30,
          orderBranch: {
            yes: { subject: "Legacy branch", content: defaultContent },
            no: { subject: "Cart discount", content: defaultContent },
          },
          branchMinutes: 1440,
        }
      : {}),
  },
}));
function App() {
  const [resources, setResources] = useState(initial);
  return (
    <main className="marketing" style={{ maxWidth: 1200, padding: 24 }}>
      <header className="mk-header">
        <div>
          <p className="mk-eyebrow">CORALS ANONYMOUS / OUR KLAVIYO</p>
          <h1>Flows</h1>
          <p>Automated customer journeys.</p>
        </div>
        <span className="mk-status">Sending disabled</span>
      </header>
      <FlowsWorkspace
        resources={resources}
        messageCounts={[
          { flowKey: "b2b-welcome", status: "PENDING", _count: 1 },
          { flowKey: "b2b-welcome", status: "SENT", _count: 2 },
          { flowKey: "abandoned-cart", status: "CANCELLED", _count: 4 },
        ]}
        setup={{
          sendingEnabled: false,
          emailReady: true,
          migrationConfirmed: true,
        }}
        unresolved={0}
        settings={defaultMarketingSettings}
        busy={false}
        refresh={async () => {}}
        testEmail={async () => ({ ok: true })}
        save={async (resource, data, enabled) => {
          if (localStorage.getItem("failSave")) return undefined;
          const saved = { ...resource, data, enabled };
          setResources((list) =>
            list.map((r) => (r.id === saved.id ? saved : r)),
          );
          localStorage.setItem("savedFlow", JSON.stringify(saved));
          return saved;
        }}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
