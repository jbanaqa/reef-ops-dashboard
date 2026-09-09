import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
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
});
let cleanup: () => void;
afterEach(() => cleanup?.());
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
  testing.fireEvent.click(view.getByText("First"));
  assert.equal(
    (view.getByLabelText("Subject") as HTMLInputElement).value,
    "First",
  );
  testing.fireEvent.change(view.getByLabelText(/Button destination/), {
    target: { value: "https://" },
  });
  assert.ok(view.getByRole("status"));
  testing.fireEvent.click(view.getByText("Done"));
  testing.fireEvent.click(view.getByText("180 minutes after trigger"));
  const input = view.getByLabelText("Wait (minutes)") as HTMLInputElement;
  assert.equal(input.value, "180");
  testing.fireEvent.change(input, { target: { value: "60" } });
  testing.fireEvent.click(view.getByText("Done"));
  testing.fireEvent.click(view.getByText("Save flow"));
  assert.equal(saved?.steps[0].minutes, 60);
  assert.equal(saved?.steps[1].minutes, 1440);
});
