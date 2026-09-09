import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import SettingsWorkspace, {
  SettingsData,
} from "../app/our-klaviyo/SettingsWorkspace";
function App() {
  const [data, setData] = useState<SettingsData | null>(null);
  async function refresh() {
    const r = await fetch("/api/marketing");
    setData(await r.json());
  }
  useEffect(() => {
    fetch("/api/marketing")
      .then((r) => r.json())
      .then(setData);
  }, []);
  return (
    <main className="marketing" style={{ padding: 24, maxWidth: 1200 }}>
      <header className="mk-header">
        <div>
          <p className="mk-eyebrow">CORALS ANONYMOUS / OUR KLAVIYO</p>
          <h1>Settings</h1>
          <p>Manage your email workspace.</p>
        </div>
        <span className="mk-status">Sending disabled</span>
      </header>
      {data && <SettingsWorkspace data={data} refresh={refresh} />}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
