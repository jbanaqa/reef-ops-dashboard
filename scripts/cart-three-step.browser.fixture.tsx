import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import FlowEditor from "../app/our-klaviyo/FlowEditor";
import { defaultContent, defaultMarketingSettings } from "../lib/marketing/rules";
import { cartEmail } from "../lib/marketing/cart-config";
import { validateFlow } from "../lib/marketing/flow-config";

const artwork = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const first = cartEmail("first"), offer = cartEmail("no");
const initial = { id: "three-step-editor", key: "abandoned-cart", name: "Abandoned Cart", enabled: false,
  data: { reviewed: false, cart: { version: 1, productCount: 0, minimumSubtotal: 100, sendStartHour: 9, sendEndHour: 20 },
    steps: [{ ...first, subject: "Saved first cart email", minutes: 180, channel: "EMAIL", content: { ...first.content, hero: artwork, bodyHtml: '<p style="color:#204e9c">Saved first email HTML</p>' } }],
    smsContent: defaultContent, smsMinutes: 30, branchMinutes: 1440,
    orderBranch: { yes: cartEmail("yes"), no: { ...offer, subject: "Your saved 10% offer", content: { ...offer.content, hero: artwork, bodyHtml: '<p style="font-size:21px">Your saved offer: 10% off</p><p>Expires {{ coupon_expires }}. {{ coupon_time_left }} remaining.</p>' } } },
  } };
function App() {
  const [resource, setResource] = useState(() => JSON.parse(localStorage.getItem("threeStepSaved") || JSON.stringify(initial)));
  return <main className="marketing" style={{ maxWidth: 1200, padding: 20, margin: "auto" }}>
    <FlowEditor resource={resource} busy={false} settings={defaultMarketingSettings}
      save={async (data, enabled) => {
        const validated = validateFlow("abandoned-cart", data);
        const saved = { ...resource, data: validated, enabled };
        localStorage.setItem("threeStepSaved", JSON.stringify(saved));
        setResource(saved);
        return saved;
      }} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
