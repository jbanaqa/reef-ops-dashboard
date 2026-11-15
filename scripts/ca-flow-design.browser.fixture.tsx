import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import FlowEditor from "../app/our-klaviyo/FlowEditor";
import EmailDesigner from "../app/our-klaviyo/EmailDesigner";
import EmailPreview from "../app/our-klaviyo/EmailPreview";
import MarketingBrandWorkspace from "../app/our-klaviyo/MarketingBrand";
import { applyCoralsReefDesign } from "../lib/marketing/corals-reef";
import { cartEmail, threeStepCartDraft } from "../lib/marketing/cart-config";
import { defaultWelcome, welcomeSteps } from "../lib/marketing/welcome-config";
import { content, defaultContent, defaultMarketingSettings, render, type Content } from "../lib/marketing/rules";
import { defaultMacroCampaignContent } from "../lib/marketing/brands";
import { validateFlow, type FlowConfig } from "../lib/marketing/flow-config";

const query = new URLSearchParams(location.search);
const mode = query.get("mode") || "render";
const expiry = "2027-01-22T20:00:00.000Z";
const products = [
  ["Blueberry Gorgonian", "$15.00", "$29.99"], ["Gold Sky Branching Hammer", "$40.00", "$79.99"],
  ["Mixed Zoa Colony", "$39.00", "$77.99"], ["WYSIWYG Green Bubble Coral", "$99.00", "$219.99"],
  ["Red and White Coco Worm", "$40.00", "$79.99"], ["Pink Candyland Zoa", "$24.99", "$49.99"],
].map(([title, price, compareAtPrice], index) => ({ title, price, compareAtPrice,
  url: `https://coralsanonymous.com/products/fixture-${index + 1}`, image: "https://fixture.example/product.png?shape=" + (index % 3) }));
const first = cartEmail("first"), offer = cartEmail("no");
const legacyCart: FlowConfig = { reviewed: false, cart: { version: 1, productCount: 6, minimumSubtotal: 100 },
  steps: [{ ...first, channel: "EMAIL", minutes: 180 }], smsMinutes: 30, smsContent: defaultContent, branchMinutes: 1440,
  orderBranch: { yes: cartEmail("yes"), no: offer } };
const cart = threeStepCartDraft(legacyCart);
cart.steps = cart.steps.map((step, index) => ({ ...step, content: applyCoralsReefDesign({ ...step.content,
  footerTitle: "Saved legacy footer title", footerImage: "https://fixture.example/legacy-footer.png", footerScale: 1.2,
  footerBackgroundColor: "#123456", footerTextColor: "#edf4fa" }, "abandoned-cart", index) }));
const welcome: FlowConfig = { reviewed: false, welcome: defaultWelcome,
  steps: structuredClone(welcomeSteps).map((step, index) => ({ ...step, content: applyCoralsReefDesign(step.content, "welcome", index) })) };
const info = (flowKey: string, heading: string, bodyHtml: string): FlowConfig => ({ reviewed: false,
  steps: [{ minutes: 0, channel: "EMAIL", subject: heading,
    content: applyCoralsReefDesign({ ...defaultContent, template: "b2b-wholesale", heading, bodyHtml, introText: "",
      body: "Saved information copy", button: "Visit our store", url: "https://coralsanonymous.com" }, flowKey, 0) }] });
const b2b = info("b2b-welcome", "Welcome to Corals Anonymous Wholesale!", '<p>Saved wholesale copy with <strong>weekly specials</strong>.</p><p>Read our <a href="https://coralsanonymous.com/pages/wholesale">wholesale information</a>.</p>');
const delivery = info("delivery-upsell", "Your delivery is coming up", '<p>Saved delivery notice. Add eligible items before packing.</p>');
const cases = [
  ...cart.steps.map((step, index) => ({ id: ["cart-first", "cart-ten", "cart-fifteen"][index], flowKey: "abandoned-cart", index, content: step.content, subject: step.subject })),
  ...welcome.steps.map((step, index) => ({ id: ["welcome-first", "welcome-reminder", "welcome-final", "welcome-social"][index], flowKey: "welcome", index, content: step.content, subject: step.subject })),
  { id: "b2b", flowKey: "b2b-welcome", index: 0, content: b2b.steps[0].content, subject: b2b.steps[0].subject },
  { id: "delivery", flowKey: "delivery-upsell", index: 0, content: delivery.steps[0].content, subject: delivery.steps[0].subject },
];
const chosen = cases.find(item => item.id === query.get("case")) || cases[0];
const settings = { ...defaultMarketingSettings, organizationName: "Corals Anonymous", postalAddress: "4471 Prospect Ave, Yorba Linda, CA 92886",
  branding: { logo: "https://fixture.example/legacy-logo.png", logoScale: 1.15, footerConfigured: true } };
const unsubscribe = "https://unsubscribe.coralsanonymous.com/api/marketing/unsubscribe?token=fixture-token";
function prepared(value: Content, item = chosen) {
  const gift = value.reefDesign?.variant === "gift";
  return content({ ...value, products: item.flowKey === "abandoned-cart" || item.id === "welcome-social" ? products.slice(0, Number(query.get("products") ?? 6)) : [],
    ...(gift ? { couponCode: item.flowKey === "welcome" ? "WELCOME10-PREVIEW" : "AC300-PREVIEW", couponExpiresAt: expiry } : {}),
    url: item.flowKey === "abandoned-cart" ? "https://coralsanonymous.com/checkouts/fixture-unique-checkout" : value.url });
}
function App() {
  const resourceFlow = chosen.flowKey === "abandoned-cart" ? cart : chosen.flowKey === "welcome" ? welcome : chosen.flowKey === "b2b-welcome" ? b2b : delivery;
  const initial = { id: "reef-design-" + chosen.flowKey, key: chosen.flowKey,
    name: chosen.flowKey === "abandoned-cart" ? "Abandoned Cart" : chosen.flowKey === "welcome" ? "Welcome" : chosen.flowKey === "b2b-welcome" ? "B2B Welcome" : "Delivery notice",
    enabled: false, data: resourceFlow as unknown as Record<string, unknown> };
  const [resource, setResource] = useState(() => JSON.parse(localStorage.getItem("reef-design-saved:" + chosen.flowKey) || "null") || initial);
  const [raw, setRaw] = useState<Content>(query.get("source") === "flow" ? chosen.content : query.get("brand") === "macroalgae-farms" ? defaultMacroCampaignContent : { ...defaultContent });
  const [subject, setSubject] = useState("Campaign subject");
  const [status, setStatus] = useState("");
  const metadata = { cases: cases.map(item => ({ id: item.id, flowKey: item.flowKey, index: item.index, heading: item.content.heading,
    variant: item.content.reefDesign?.variant, offerPercent: item.content.reefDesign?.offerPercent })),
    chosen: chosen.id, originalFlow: resourceFlow, sharedBranding: settings.branding };
  if (mode === "render") {
    const c = prepared(chosen.content);
    let html = render(c, unsubscribe, settings.postalAddress, "Jamie Reef", settings.organizationName);
    if (query.get("stripped") === "1") html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
    return <><output id="fixture-meta" hidden>{JSON.stringify(metadata)}</output><EmailPreview html={html} mobile mobileWidth={Number(query.get("width") || 600)} /></>;
  }
  if (mode === "campaign") return <MarketingBrandWorkspace tab="campaigns" initialBrand={query.get("brand") === "macroalgae-farms" ? "macroalgae-farms" : "corals-anonymous"}>
    <EmailDesigner title="Campaign draft" subject={subject} content={raw} html={render(raw, unsubscribe, "", "", settings.organizationName)} previewError="" busy={false} status={status}
      organizationName={query.get("brand") === "macroalgae-farms" ? "Macroalgae Farms" : settings.organizationName} postalAddress=""
      onSubject={setSubject} onContent={(key, value) => setRaw(previous => ({ ...previous, [key]: value }))}
      onSave={async () => { setStatus("Fixture saved"); return true; }} onClose={() => {}} />
  </MarketingBrandWorkspace>;
  return <main className="marketing" style={{ maxWidth: 1200, margin: "auto", padding: 20 }}>
    <output id="fixture-meta" hidden>{JSON.stringify(metadata)}</output>
    <FlowEditor resource={resource} busy={false} settings={settings}
      save={async (data, enabled) => {
        const validated = validateFlow(chosen.flowKey, data);
        const saved = { ...resource, data: validated, enabled };
        localStorage.setItem("reef-design-saved:" + chosen.flowKey, JSON.stringify(saved));
        localStorage.setItem("reef-design-branding", JSON.stringify(settings.branding));
        setResource(saved); return saved;
      }} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
