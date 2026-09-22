import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { IDBFactory } from "fake-indexeddb";
import { readDraft } from "../app/our-klaviyo/flow-drafts";
import EmailPreview from "../app/our-klaviyo/EmailPreview";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import {
  defaultCampaignContent,
  defaultContent,
  defaultMarketingSettings,
} from "../lib/marketing/rules";
import FlowEditor from "../app/our-klaviyo/FlowEditor";
import SettingsWorkspace from "../app/our-klaviyo/SettingsWorkspace";
import CampaignEmailFields from "../app/our-klaviyo/CampaignEmailFields";
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
    assert.match(w.document.body.textContent!, /Thanks for joining/);
  } finally { popup.window.close(); }
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

test("footer fields save with the email while sender details remain visible", async () => {
  const testing = await import("@testing-library/react");
  cleanup = testing.cleanup;
  const r = resource("b2b-welcome", "Footer test");
  Object.assign(r.data.steps[0].content, { template: "b2b-wholesale" });
  let saved: unknown;
  const view = testing.render(
    <FlowEditor
      resource={r}
      busy={false}
      settings={{
        ...defaultMarketingSettings,
        postalAddress: "123 Valid Street",
      }}
      save={async (data, enabled) => {
        saved = data;
        return { ...r, data, enabled };
      }}
    />,
  );
  testing.fireEvent.click(await view.findByText("Footer test"));
  testing.fireEvent.click(view.getByRole("button", { name: "Footer" }));
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
  assert.ok(view.getByText(/123 Valid Street/));
  const addressToggle = view.getByLabelText(
    "Show business address in this email",
  ) as HTMLInputElement;
  assert.equal(addressToggle.checked, false);
  testing.fireEvent.click(addressToggle);
  testing.fireEvent.click(view.getByRole("button", { name: "Save email" }));
  await testing.waitFor(() =>
    assert.ok(view.getByText("Email saved", { exact: true })),
  );
  const result = saved as {
    steps: {
      content: {
        footerTitle: string;
        footerText: string;
        showPostalAddress: boolean;
        footerCopyrightText?: string;
        instagramIcon?: string;
      };
    }[];
  };
  assert.equal(result.steps[0].content.showPostalAddress, true);
  assert.equal(result.steps[0].content.footerTitle, "Thank you, partners");
  assert.equal(
    result.steps[0].content.footerCopyrightText,
    "© {{ year }} Reef Team",
  );
  assert.match(result.steps[0].content.instagramIcon || "", /^data:image\/png;base64,/);
  assert.equal(
    result.steps[0].content.footerText,
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
