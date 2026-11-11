import test from "node:test";
import assert from "node:assert/strict";
import { isolated, type Context } from "./cart-launch.integration";
import { cartOfferSettingsError, threeStepCartDraft } from "../lib/marketing/cart-config";
import { validateFlow } from "../lib/marketing/flow-config";
import { content, couponExpiryDate, couponTimeLeft, defaultContent, render, textBody } from "../lib/marketing/rules";

export function registerCartSettingsTests(context: () => Context) {
  test("cart settings reject an expiring final offer through validation and the real save route without changing saved data", async () => isolated(context(), "offer-settings", async h => {
    const previousAuth = process.env.DASHBOARD_AUTH_DISABLED;
    process.env.DASHBOARD_AUTH_DISABLED = "true";
    try {
      const api = await import("../app/api/marketing/route");
      const config = validateFlow("abandoned-cart", threeStepCartDraft(h.f));
      config.steps[0].content.bodyHtml = '<p style="font-size:21px">Saved first email</p>';
      config.steps[1].content.bodyHtml = '<p><strong>Saved 10% offer</strong></p>';
      config.steps[2].content.bodyHtml = '<p><strong>Saved 15% final offer</strong></p>';
      config.steps[1].content.hero = "https://store.example/saved-artwork.png";
      config.steps[2].content.hero = config.steps[1].content.hero;
      const expected = validateFlow("abandoned-cart", config);
      await h.prisma.marketingResource.update({ where: { id: h.flowId }, data: { data: h.store.json(config) } });
      const before = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: h.flowId } });
      const request = (data: unknown) => new Request("https://dashboard.example/api/marketing?brand=corals-anonymous", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save-resource", kind: "FLOW", key: "abandoned-cart", name: before.name, enabled: before.enabled, data }),
      });
      for (const hours of [1, 24]) {
        const invalid = { ...config, cart: { ...config.cart!, couponHours: hours } };
        assert.match(cartOfferSettingsError(invalid) || "", /at least 1 hour beyond the final email wait/);
        assert.throws(() => validateFlow("abandoned-cart", invalid), /at least 1 hour beyond the final email wait/);
        const response = await api.POST(request(invalid));
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /at least 1 hour beyond the final email wait/);
        assert.deepEqual(await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: h.flowId } }), before,
          "Rejected settings cannot change the saved content, artwork, enablement or timestamps");
      }
      const valid = { ...config, cart: { ...config.cart!, couponHours: 25 } };
      assert.equal(cartOfferSettingsError(valid), null, "Exactly one hour beyond the final delay is allowed");
      assert.equal(validateFlow("abandoned-cart", valid).cart?.couponHours, 25);
      const tooLong = { ...config, cart: { ...config.cart!, couponHours: 25 },
        steps: config.steps.map((step, index) => index === 2 ? { ...step, minutes: 1441 } : step) };
      assert.throws(() => validateFlow("abandoned-cart", tooLong), /at least 1 hour beyond the final email wait/,
        "Increasing the final wait also repeats the lifetime check");
      const response = await api.POST(request(config));
      assert.equal(response.status, 200, "The approved seven-day lifetime and original waits remain valid");
      const saved = await h.prisma.marketingResource.findUniqueOrThrow({ where: { id: h.flowId } });
      const data = saved.data as unknown as typeof config;
      assert.equal(data.cart?.couponHours, 168);
      assert.equal(saved.enabled, before.enabled);
      assert.deepEqual(data.steps.map(step => step.minutes), config.steps.map(step => step.minutes));
      assert.deepEqual(data.steps.map(step => step.content.bodyHtml), expected.steps.map(step => step.content.bodyHtml));
      assert.deepEqual(data.steps.map(step => step.content.hero), expected.steps.map(step => step.content.hero));
      assert.equal(await h.prisma.marketingMessage.count({ where: { shop: h.shop } }), 0);
      assert.equal(h.emails.length, 0);
    } finally {
      if (previousAuth === undefined) delete process.env.DASHBOARD_AUTH_DISABLED;
      else process.env.DASHBOARD_AUTH_DISABLED = previousAuth;
    }
  }));

  test("cart HTML body and plain text show the same actual code expiration without literal template tokens", () => {
    const expiry = new Date(Date.now() + 7 * 86400000).toISOString();
    const value = content({ ...defaultContent, template: "cart-recovery", couponCode: "AC300-PREVIEW",
      couponExpiresAt: expiry, couponTerms: "15% off. One use.",
      bodyHtml: '<p style="font-size:20px">Expires {{ coupon_expires }}. {{ coupon_time_left }} remaining.</p>' });
    const html = render(value, "https://store.example/unsubscribe", "123 Ocean Avenue"), plain = textBody(value);
    for (const output of [html, plain]) {
      assert.ok(output.includes(couponExpiryDate(expiry)));
      assert.ok(output.includes(couponTimeLeft(expiry)));
      assert.doesNotMatch(output, /\{\{ coupon_(?:expires|time_left) \}\}/);
    }
    assert.match(html, /15% off/);
    assert.match(html, /Pacific time/);
    const fallback = render({ ...value, couponExpiresAt: undefined, couponExpiryFallbackText: '<img src=x onerror="alert(1)">' }, "https://store.example/unsubscribe", "");
    assert.ok(fallback.includes("&lt;img"), "An expiry fallback is text, not new HTML markup");
    assert.doesNotMatch(fallback, /<img src=x onerror=/);
  });
}
