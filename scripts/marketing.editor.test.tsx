import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { IDBFactory } from "fake-indexeddb";
import { readDraft } from "../app/our-klaviyo/flow-drafts";
import EmailPreview from "../app/our-klaviyo/EmailPreview";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import {
  defaultContent,
  defaultMarketingSettings,
} from "../lib/marketing/rules";
import FlowEditor from "../app/our-klaviyo/FlowEditor";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example",
});
Object.assign(globalThis, {
  window: dom.window,
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
      };
    }[];
  };
  assert.equal(result.steps[0].content.showPostalAddress, true);
  assert.equal(result.steps[0].content.footerTitle, "Thank you, partners");
  assert.equal(
    result.steps[0].content.footerText,
    "Contact our wholesale team.",
  );
});
