import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { IDBFactory } from "fake-indexeddb";
import { readDraft } from "../app/our-klaviyo/flow-drafts";
import EmailPreview from "../app/our-klaviyo/EmailPreview";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import {
  type Content,
  defaultCampaignContent,
  defaultContent,
  defaultMarketingSettings,
} from "../lib/marketing/rules";
import FlowEditor from "../app/our-klaviyo/FlowEditor";
import SettingsWorkspace from "../app/our-klaviyo/SettingsWorkspace";
import CampaignEmailFields from "../app/our-klaviyo/CampaignEmailFields";
import CartTools from "../app/our-klaviyo/CartTools";
import {
  defaultDeliveryUpsell,
  deliveryUpsellContent,
} from "../lib/marketing/delivery-upsell-config";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example",
});
Object.assign(globalThis, {
  window: dom.window,
  self: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  FileReader: dom.window.FileReader,
});
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
let cleanup: () => void;
test("single-opt-in popup submits consent and finishes without a confirmation or SMS step", async () => {
  const popup = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://store.example", runScripts: "dangerously" });
  const requests: Record<string, unknown>[] = [];
  const w = popup.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  const nativeTimeout = w.setTimeout.bind(w);
  w.setTimeout = ((handler: TimerHandler) => nativeTimeout(handler, 0)) as typeof w.setTimeout;
  w.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return Response.json(body.action === "config" ? { enabled: true, singleOptIn: true, couponDays: 30 } : body.action === "signup" ? { ok: true, completed: true, message: "Your offer will arrive by email." } : { ok: true });
  };
  try {
    const script = w.document.createElement("script");
    script.dataset.endpoint = "https://app.example/api/marketing/storefront";
    script.textContent = await readFile("public/reef-marketing.js", "utf8");
    w.document.body.append(script);
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => assert.ok(w.document.querySelector("form")));
    assert.ok(w.document.querySelector("dialog.reef-signup-dialog"));
    assert.ok(w.document.querySelector(".reef-signup-shell"));
    assert.ok(w.document.querySelector(".reef-signup-art"));
    assert.match(w.document.body.textContent!, /Join our Reefing\s*Family!/);
    assert.match(w.document.body.textContent!, /10% OFF/);
    assert.equal(
      w.document.querySelector<HTMLInputElement>('[name="email"]')?.placeholder,
      "Email",
    );
    assert.equal(
      w.document.querySelector<HTMLButtonElement>('[type="submit"]')?.textContent,
      "Continue",
    );
    assert.match(w.document.body.textContent!, /offer lasts 30 days/);
    w.document.querySelector<HTMLInputElement>('[name="email"]')!.value = "test@example.com";
    w.document.querySelector<HTMLInputElement>('[name="consent"]')!.checked = true;
    w.document.querySelector("form")!.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => assert.equal(w.localStorage.getItem("reef-marketing-submitted"), "1"));
    assert.equal(requests.filter(r => r.action === "signup").length, 1);
    assert.equal(requests.find(r => r.action === "signup")?.emailConsent, true);
    assert.equal(requests.some(r => r.action === "sms" || r.action === "status"), false);
    assert.equal(w.document.querySelector("form"), null);
    assert.equal(w.document.querySelector(".reef-signup-launcher"), null);
    assert.match(w.document.body.textContent!, /Thanks for joining/);
  } finally { popup.window.close(); }
});

test("signup typo suggestions require an explicit correction or confirmation and never silently change an email", async () => {
  for (const choice of ["correct", "keep"]) {
    const popup = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://store.example", runScripts: "dangerously" });
    const w = popup.window;
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    const nativeTimeout = w.setTimeout.bind(w);
    w.setTimeout = ((handler: TimerHandler) => nativeTimeout(handler, 0)) as typeof w.setTimeout;
    const requests: Record<string, unknown>[] = [];
    w.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.action === "config") return Response.json({ enabled: true, singleOptIn: true });
      if (body.action !== "signup") return Response.json({ ok: true });
      requests.push(body);
      if (requests.length === 1) return Response.json({ emailSuggestion: "test@gmail.com" });
      return Response.json({ completed: true });
    };
    try {
      const script = w.document.createElement("script");
      script.dataset.endpoint = "https://app.example/api/marketing/storefront";
      script.textContent = await readFile("public/reef-marketing.js", "utf8");
      w.document.body.append(script);
      const { waitFor } = await import("@testing-library/react");
      await waitFor(() => assert.ok(w.document.querySelector("form")));
      w.document.querySelector<HTMLInputElement>('[name="email"]')!.value = "test@gmial.com";
      w.document.querySelector<HTMLInputElement>('[name="consent"]')!.checked = true;
      w.document.querySelector("form")!.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
      await waitFor(() => assert.match(w.document.body.textContent!, /Keep my address/));
      assert.equal(requests.length, 1);
      assert.equal(w.document.querySelector<HTMLInputElement>('[name="email"]')!.value, "test@gmial.com");
      const button = [...w.document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === (choice === "correct" ? "Use test@gmail.com" : "Keep my address"))!;
      button.click();
      await waitFor(() => assert.equal(w.localStorage.getItem("reef-marketing-submitted"), "1"));
      assert.equal(requests.length, 2);
      assert.equal(requests[1].email, choice === "correct" ? "test@gmail.com" : "test@gmial.com");
      assert.equal(requests[1].emailConsent, true);
      assert.equal(requests[1].confirmEmailDomain, choice === "keep" ? "test@gmial.com" : "");
    } finally { w.close(); }
  }
});

test("dismissed visitors can reopen signup; cross-tab signup removes both controls", async () => {
  const popup = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://store.example", runScripts: "dangerously" });
  const w = popup.window;
  const requests: Record<string, unknown>[] = [];
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  const nativeTimeout = w.setTimeout.bind(w);
  w.setTimeout = ((handler: TimerHandler) => nativeTimeout(handler, 0)) as typeof w.setTimeout;
  w.localStorage.setItem("reef-marketing-dismissed", String(Date.now()));
  w.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return Response.json(body.action === "config" ? { enabled: true, singleOptIn: true, dismissalDays: 7 } : { ok: true });
  };
  try {
    const script = w.document.createElement("script");
    script.dataset.endpoint = "https://app.example/api/marketing/storefront";
    script.textContent = await readFile("public/reef-marketing.js", "utf8");
    w.document.body.append(script);
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => assert.ok(w.document.querySelector(".reef-signup-launcher")));
    const launcher = w.document.querySelector<HTMLButtonElement>(".reef-signup-launcher")!;
    const dialog = w.document.querySelector<HTMLDialogElement>("dialog")!;
    assert.equal(dialog.open, false);
    assert.equal(launcher.hidden, false);
    assert.equal(requests.some(r => r.type === "FORM_VIEWED"), false);
    launcher.click();
    assert.equal(dialog.open, true);
    assert.equal(launcher.hidden, true);
    assert.equal(requests.filter(r => r.type === "FORM_VIEWED").length, 1);
    dialog.dispatchEvent(new w.Event("cancel", { cancelable: true }));
    assert.equal(dialog.open, false);
    assert.equal(launcher.hidden, false);
    assert.equal(w.document.activeElement, launcher);
    launcher.click();
    assert.equal(dialog.open, true);
    assert.equal(w.document.querySelectorAll("form").length, 1);
    w.localStorage.setItem("reef-marketing-submitted", "1");
    w.dispatchEvent(new w.StorageEvent("storage", { key: "reef-marketing-submitted", newValue: "1" }));
    assert.equal(w.document.querySelector("dialog"), null);
    assert.equal(w.document.querySelector(".reef-signup-launcher"), null);
  } finally { w.close(); }
});

test("signed-in customers, known subscribers, completed signups and disabled forms have no popup or tab", async () => {
  const source = await readFile("public/reef-marketing.js", "utf8");
  for (const mode of ["signed-in-unsubscribed", "signed-in-subscribed", "subscriber", "submitted", "disabled"]) {
    const popup = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://store.example", runScripts: "dangerously" });
    const w = popup.window;
    const nativeTimeout = w.setTimeout.bind(w);
    w.setTimeout = ((handler: TimerHandler) => nativeTimeout(handler, 0)) as typeof w.setTimeout;
    w.fetch = async () => Response.json({ enabled: mode !== "disabled" });
    try {
      if (mode === "submitted") w.localStorage.setItem("reef-marketing-submitted", "1");
      const script = w.document.createElement("script");
      script.dataset.endpoint = "https://app.example/api/marketing/storefront";
      if (mode.startsWith("signed-in")) {
        script.dataset.knownCustomer = "true";
        script.dataset.emailSubscriber = String(mode === "signed-in-subscribed");
      }
      if (mode === "subscriber") script.dataset.emailSubscriber = "true";
      script.textContent = source;
      w.document.body.append(script);
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(w.document.querySelector("dialog, .reef-signup-launcher"), null, mode);
    } finally { w.close(); }
  }
});
test("settings presents the resumable Klaviyo audience backfill", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).includes("view=engagement-backfill"))
      return Response.json({
        configured: true,
        phase: "not-started",
        events: 0,
        profiles: 0,
      });
    return Response.json({
      configured: true,
      phase: "memberships",
      profiles: 120,
      memberships: 45,
      suppressed: 3,
      ignored: 2,
      errors: 1,
      lists: ["Mailable Subscribers"],
      currentList: "Mailable Subscribers",
      issues: [
        {
          profile: "conflict@example.com",
          phase: "Profiles",
          error: "Identity conflict",
        },
      ],
    });
  };
  try {
    const view = testing.render(
      <SettingsWorkspace
        data={{
          settings: defaultMarketingSettings,
          setup: {},
          resources: [],
          messageCounts: [],
        }}
        refresh={async () => {}}
      />,
    );
    testing.fireEvent.click(view.getByRole("button", { name: /Advanced/ }));
    assert.ok(await view.findByText("Bring over the Klaviyo audience"));
    assert.ok(await view.findByText("Importing Mailable Subscribers"));
    assert.ok(view.getByRole("button", { name: "Continue backfill" }));
    testing.fireEvent.click(view.getByText("Profiles that need review"));
    assert.ok(view.getByText(/conflict@example.com/));
  } finally {
    globalThis.fetch = original;
  }
});
afterEach(() => cleanup?.());
test("cart results show delivery failures, credited orders, timestamped messages and refreshed data", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ attribution: { emailClickDays: 5, emailOpenDays: 5 },
      rows: [{ key: "first", label: "Email #1 · Soft push", waiting: 1, sent: 2, delivered: 1, opened: 1, clicked: 0, bounced: 1, complained: 0, orders: 1, revenue: { USD: 100 }, stopped: 0, needsAttention: 0 }], reasons: [],
      orders: [{ id: "order1", label: "#123", url: "https://audit.myshopify.com/admin/orders/123", email: "buyer@example.com", at: "2026-10-18T20:00:00Z", step: "Email #1 · Soft push", currency: "USD", amount: 100, interaction: "Open", interactedAt: "2026-10-18T19:00:00Z" }],
      activity: [{ id: "message1", subject: "Your cart", status: "PENDING", email: "pending@example.com", triggerAt: "2026-10-18T18:00:00Z", dueAt: "2026-10-18T21:00:00Z", sentAt: null, error: "Waiting for 16-hour email spacing" }],
    });
  };
  try {
    const view = testing.render(<CartTools flow={{ reviewed: true, steps: [] }} />);
    testing.fireEvent.click(view.getByRole("button", { name: "View flow results" }));
    assert.ok(await view.findByText("Bounced"));
    assert.ok(view.getByText("Spam complaints"));
    assert.equal(view.getByRole("link", { name: /#123/ }).getAttribute("href"), "https://audit.myshopify.com/admin/orders/123");
    assert.ok(view.getByText("buyer@example.com"));
    testing.fireEvent.click(view.getByText("Recent messages · latest 25"));
    assert.ok(view.getByText("pending@example.com"));
    assert.ok(view.getByText("Waiting for 16-hour email spacing"));
    assert.ok(view.getByText(/All times Pacific/));
    testing.fireEvent.click(view.getByRole("button", { name: "Refresh results" }));
    await testing.waitFor(() => assert.equal(requests, 2));
  } finally { globalThis.fetch = original; }
});
test.beforeEach(() => {
  Object.assign(globalThis, { indexedDB: new IDBFactory() });
});
const resource = (key: string, subject: string, minutes = 0) => ({
  key,
  name: key,
  enabled: false,
  data: {
    reviewed: false,
    steps: [
      {
        minutes,
        subject,
        channel: "EMAIL",
        content: { ...defaultContent, heading: subject },
      },
    ],
  },
});
test("switching flows does not transfer content or enabled state", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  let saved: unknown;
  const a = { ...resource("welcome", "Welcome"), enabled: true };
  const b = resource("b2b-welcome", "B2B");
  const props = {
    busy: false,
    settings: defaultMarketingSettings,
    save: (data: unknown, enabled: boolean) => {
      saved = { data, enabled };
    },
  };
  const view = testing.render(<FlowEditor resource={a} {...props} />);
  view.rerender(<FlowEditor resource={b} {...props} />);
  await view.findByText("Save flow");
  testing.fireEvent.click(view.getByText("Save flow"));
  assert.equal(
    (saved as { data: { steps: { subject: string }[] } }).data.steps[0].subject,
    "B2B",
  );
  assert.equal((saved as { enabled: boolean }).enabled, false);
});
test("message and delay nodes edit their explicit target and invalid links do not crash", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  let saved: { steps: { minutes: number; subject: string }[] } | undefined;
  const r = resource("welcome", "First", 180);
  r.data.steps.push({
    minutes: 1440,
    subject: "Second",
    channel: "EMAIL",
    content: defaultContent,
  });
  const view = testing.render(
    <FlowEditor
      resource={r}
      busy={false}
      settings={defaultMarketingSettings}
      save={(data) => {
        saved = data;
      }}
    />,
  );
  await view.findByText("Welcome · 10% off");
  testing.fireEvent.click(view.getByText("Welcome · 10% off"));
  assert.equal(
    (view.getByLabelText("Subject") as HTMLInputElement).value,
    "First",
  );
  testing.fireEvent.change(view.getByLabelText(/Button destination/), {
    target: { value: "https://" },
  });
  assert.ok(view.getByRole("alert"));
  testing.fireEvent.click(view.getByLabelText("Back to flow"));
  testing.fireEvent.click(view.getByText("Day 3"));
  const input = view.getByLabelText("First reminder · day") as HTMLInputElement;
  assert.equal(input.value, "3");
  testing.fireEvent.change(input, { target: { value: "4" } });
  testing.fireEvent.click(view.getByText("Close editor"));
  testing.fireEvent.click(view.getByText("Save flow"));
  assert.equal(saved?.steps[0].minutes, 0);
  assert.equal(saved?.steps[1].minutes, 4 * 1440);
});

test("unfinished copy and artwork survive editor remounts and successful saves", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  const r = resource("b2b-welcome", "Original");
  Object.assign(r.data.steps[0].content, { template: "b2b-wholesale" });
  const props = {
    busy: false,
    settings: defaultMarketingSettings,
    save: async (data: unknown, enabled: boolean) => ({ ...r, data, enabled }),
  };
  let view = testing.render(<FlowEditor resource={r} {...props} />);
  testing.fireEvent.click(await view.findByText("Original"));
  testing.fireEvent.change(view.getByLabelText("Subject"), {
    target: { value: "My custom subject" },
  });
  testing.fireEvent.click(view.getByText("Edit HTML"));
  testing.fireEvent.change(view.getByLabelText(/Message HTML/), {
    target: {
      value: '<p>My custom copy</p><img src="https://example.com/art.png">',
    },
  });
  testing.fireEvent.click(view.getByText("Artwork"));
  testing.fireEvent.change(view.getByLabelText("Logo image"), {
    target: {
      files: [
        new dom.window.File(["artwork"], "logo.png", { type: "image/png" }),
      ],
    },
  });
  await testing.waitFor(() => assert.ok(view.getByText("Remove logo")));
  await testing.waitFor(async () => {
    const draft = await readDraft<{
      flow: { steps: { subject: string; content: { logo?: string } }[] };
    }>(r.key);
    assert.equal(draft?.flow.steps[0].subject, "My custom subject");
    assert.match(
      draft?.flow.steps[0].content.logo || "",
      /^data:image\/png;base64,/,
    );
  });
  view.unmount();
  view = testing.render(<FlowEditor resource={r} {...props} />);
  testing.fireEvent.click(await view.findByText("My custom subject"));
  testing.fireEvent.click(view.getByText("Artwork"));
  assert.ok(view.getByText("Remove logo"));
  testing.fireEvent.click(view.getByText("Content"));
  testing.fireEvent.click(view.getByText("Edit HTML"));
  assert.match(
    (view.getByLabelText(/Message HTML/) as HTMLTextAreaElement).value,
    /My custom copy/,
  );
  testing.fireEvent.click(
    testing.within(view.getByRole("dialog")).getByText("Save email"),
  );
  await testing.waitFor(() =>
    assert.ok(
      view.getAllByText("Flow saved, including copy and artwork.").length,
    ),
  );
});
test("preview expands to the document height and retains scrolling fallback", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  const view = testing.render(
    <EmailPreview html="<p>Long email</p>" mobile={false} />,
  );
  const frame = view.getByTitle("Email preview") as HTMLIFrameElement;
  frame.contentDocument!.body.getBoundingClientRect = () =>
    ({ height: 1800 }) as DOMRect;
  testing.fireEvent.load(frame);
  assert.equal(frame.style.height, "1824px");
  assert.equal(frame.getAttribute("scrolling"), null);
  assert.equal(frame.getAttribute("sandbox"), "allow-same-origin");
  view.rerender(<EmailPreview html="<p>Long email</p>" mobile={true} />);
  assert.equal(frame.style.width, "375px");
});

test("footer fields save as shared branding while sender details remain visible", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  const r = resource("b2b-welcome", "Footer test");
  Object.assign(r.data.steps[0].content, { template: "b2b-wholesale" });
  let saved: unknown;
  let savedFooter: Content | undefined;
  const view = testing.render(
    <FlowEditor
      resource={r}
      busy={false}
      settings={{
        ...defaultMarketingSettings,
        postalAddress: "123 Valid Street",
      }}
      save={async (data, enabled, brandingSource) => {
        saved = data;
        savedFooter = brandingSource;
        return { ...r, data, enabled };
      }}
    />,
  );
  testing.fireEvent.click(await view.findByText("Footer test"));
  testing.fireEvent.click(view.getByRole("button", { name: "Footer" }));
  assert.equal(
    (view.getByLabelText("Footer background color") as HTMLInputElement).value,
    "#244b7b",
  );
  testing.fireEvent.change(view.getByLabelText("Footer heading"), {
    target: { value: "Thank you, partners" },
  });
  testing.fireEvent.change(view.getByLabelText("Footer message"), {
    target: { value: "Contact our wholesale team." },
  });
  testing.fireEvent.change(view.getByLabelText("Copyright line"), {
    target: { value: "© {{ year }} Reef Team" },
  });
  testing.fireEvent.change(view.getByLabelText("Instagram icon image"), {
    target: {
      files: [
        new dom.window.File(["icon"], "instagram.png", { type: "image/png" }),
      ],
    },
  });
  await testing.waitFor(() => assert.ok(view.getByText("Remove instagram icon")));
  const socialToggle = view.getByLabelText(
    "Show social media in footer",
  ) as HTMLInputElement;
  assert.equal(socialToggle.checked, true);
  testing.fireEvent.click(socialToggle);
  assert.equal(view.queryByLabelText("Social heading"), null);
  assert.ok(view.getByLabelText("Unsubscribe introduction"));
  assert.ok(view.getByText(/123 Valid Street/));
  const addressToggle = view.getByLabelText(
    "Show business address in every email footer",
  ) as HTMLInputElement;
  assert.equal(addressToggle.checked, false);
  testing.fireEvent.click(addressToggle);
  testing.fireEvent.click(view.getByRole("button", { name: "Save email" }));
  await testing.waitFor(() =>
    assert.ok(view.getByText("Email saved", { exact: true })),
  );
  assert.ok(saved);
  assert.equal(savedFooter?.showPostalAddress, true);
  assert.equal(savedFooter?.showFooterSocial, false);
  assert.equal(savedFooter?.footerTitle, "Thank you, partners");
  assert.equal(
    savedFooter?.footerCopyrightText,
    "© {{ year }} Reef Team",
  );
  assert.match(savedFooter?.instagramIcon || "", /^data:image\/png;base64,/);
  assert.equal(
    savedFooter?.footerText,
    "Contact our wholesale team.",
  );
});

test("delivery notice exposes its personalized heading and every message sentence", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  const base = resource("delivery-upsell", "Delivery notice");
  const r = {
    ...base,
    data: { ...base.data, delivery: defaultDeliveryUpsell },
  };
  r.data.steps[0].content = structuredClone(deliveryUpsellContent);
  const view = testing.render(
    <FlowEditor
      resource={r}
      busy={false}
      settings={defaultMarketingSettings}
      save={async (data, enabled) => ({ ...r, data, enabled })}
    />,
  );
  testing.fireEvent.click(await view.findByText("Delivery notice"));
  const heading = view.getByLabelText("Heading") as HTMLInputElement;
  assert.match(heading.value, /first_name\|default:"Aloha"/);
  assert.equal(
    (view.getByLabelText("Intro line") as HTMLInputElement).value,
    "",
  );
  const message = view.getByRole("textbox", { name: "Message" });
  assert.match(
    message.textContent || "",
    /Your order is shipping out tomorrow at 8AM PST!/,
  );
  assert.match(
    view.getByText(/Every sentence shown in this message area is editable/)
      .textContent || "",
    /first_name/,
  );
  testing.fireEvent.click(view.getByRole("button", { name: "Footer" }));
  assert.equal(
    (view.getByLabelText("Social heading") as HTMLInputElement).value,
    "Follow Us",
  );
  assert.equal(
    (view.getByLabelText("Unsubscribe introduction") as HTMLTextAreaElement)
      .value,
    "No longer want to receive these emails?",
  );
});

test("one editor can change a flow's visual layout without changing its template", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  const r = resource("b2b-welcome", "Universal editor");
  Object.assign(r.data.steps[0].content, { template: "b2b-wholesale" });
  let saved: unknown;
  const view = testing.render(
    <FlowEditor
      resource={r}
      busy={false}
      settings={defaultMarketingSettings}
      save={async (data, enabled) => {
        saved = data;
        return { ...r, data, enabled };
      }}
    />,
  );
  testing.fireEvent.click(await view.findByText("Universal editor"));
  testing.fireEvent.click(view.getByRole("button", { name: "Layout" }));
  testing.fireEvent.change(view.getByLabelText("Visual preset"), {
    target: { value: "campaign-sale" },
  });
  await testing.waitFor(() =>
    assert.ok(view.getByText("Email sections", { exact: true })),
  );
  const layoutGroup = view.getByText("Email layout", { exact: true }).closest("details");
  const sectionsGroup = view.getByText("Email sections", { exact: true }).closest("details");
  assert.equal(layoutGroup?.open, false);
  assert.equal(sectionsGroup?.open, false);
  testing.fireEvent.click(view.getByText("Email sections", { exact: true }));
  assert.equal(sectionsGroup?.open, true);
  const frame = view.getByTitle("Email preview") as HTMLIFrameElement;
  assert.match(frame.getAttribute("srcdoc") || "", /Universal editor/);
  testing.fireEvent.click(view.getByRole("button", { name: "Save email" }));
  await testing.waitFor(() => assert.ok(saved));
  const savedContent = (
    saved as { steps: { content: { template: string; layout: string; campaignLayout: unknown } }[] }
  ).steps[0].content;
  assert.equal(savedContent.template, "b2b-wholesale");
  assert.equal(savedContent.layout, "campaign-sale");
  assert.ok(savedContent.campaignLayout);
});

test("abandoned cart editor controls its campaign-style product cards", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  const r = resource("abandoned-cart", "Cart email");
  Object.assign(r.data.steps[0].content, { template: "cart-recovery" });
  let saved: unknown;
  const view = testing.render(
    <FlowEditor
      resource={r}
      busy={false}
      settings={defaultMarketingSettings}
      save={async (data, enabled) => {
        saved = data;
        return { ...r, data, enabled };
      }}
    />,
  );
  testing.fireEvent.click(await view.findByText("Email #1 · Soft push"));
  const frame = view.getByTitle("Email preview") as HTMLIFrameElement;
  assert.match(frame.getAttribute("srcdoc") || "", /Blueberry Gorgonian/);
  assert.match(frame.getAttribute("srcdoc") || "", /\$29\.99/);
  assert.doesNotMatch(
    frame.getAttribute("srcdoc") || "",
    /Sample Product|Example coral from your cart/,
  );
  testing.fireEvent.click(view.getByRole("button", { name: "Layout" }));
  assert.ok(view.getByText("Campaign-style cards", { exact: true }));
  testing.fireEvent.change(view.getByLabelText("Product image width"), {
    target: { value: "95" },
  });
  testing.fireEvent.click(
    view.getByRole("checkbox", { name: "Show a button on each product" }),
  );
  testing.fireEvent.click(view.getByRole("button", { name: "Save email" }));
  await testing.waitFor(() => assert.ok(saved));
  const savedContent = (
    saved as {
      steps: {
        content: {
          productGridStyle: { productImageWidth: number; showButton: boolean };
        };
      }[];
    }
  ).steps[0].content;
  assert.equal(savedContent.productGridStyle.productImageWidth, 95);
  assert.equal(savedContent.productGridStyle.showButton, false);
});

test("campaign product grid controls update count and product order together", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  let latest = structuredClone(defaultCampaignContent);
  function Editor() {
    const [draft, setDraft] = React.useState(structuredClone(defaultCampaignContent));
    latest = draft;
    return (
      <CampaignEmailFields
        content={draft}
        subject="Sale"
        onSubject={() => undefined}
        onChange={(key, value) =>
          setDraft((current) => ({ ...current, [key]: value }))
        }
      />
    );
  }
  const view = testing.render(<Editor />);
  testing.fireEvent.click(view.getByText("Email sections", { exact: true }));
  testing.fireEvent.click(
    view.getByText("Product grid · Sale product feed · 6", { exact: true }),
  );
  testing.fireEvent.change(view.getAllByLabelText("Number of products")[0], {
    target: { value: "18" },
  });
  testing.fireEvent.change(view.getAllByLabelText("Product order")[0], {
    target: { value: "best-selling" },
  });
  await testing.waitFor(() => {
    const section = latest.campaignLayout!.sections[0];
    assert.equal(section.type, "products");
    if (section.type !== "products") throw new Error("Expected product grid");
    assert.equal(section.feed?.limit, 18);
    assert.equal(section.feed?.order, "best-selling");
    assert.equal(section.products.length, 0);
  });
});

test("campaign design controls resize the logo and default product images", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  let latest = structuredClone(defaultCampaignContent);
  function Editor() {
    const [draft, setDraft] = React.useState(structuredClone(defaultCampaignContent));
    latest = draft;
    return (
      <CampaignEmailFields
        content={draft}
        subject="Sale"
        onSubject={() => undefined}
        onChange={(key, value) =>
          setDraft((current) => ({ ...current, [key]: value }))
        }
      />
    );
  }
  const view = testing.render(<Editor />);
  testing.fireEvent.click(view.getByText("Design", { exact: true }));
  testing.fireEvent.change(view.getByLabelText("Logo width"), {
    target: { value: "520" },
  });
  testing.fireEvent.change(view.getByLabelText(/Default image width/), {
    target: { value: "90" },
  });
  await testing.waitFor(() => {
    assert.equal(Math.round((latest.logoScale || 0) * 360), 520);
    assert.equal(latest.campaignLayout?.style.productImageWidth, 90);
  });
});
